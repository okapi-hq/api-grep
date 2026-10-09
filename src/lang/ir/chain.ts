import type { CallExpr, ClassDef, Expr, FunctionDef, ModuleModel } from "./model.js";
import { baseBinding, bindingOfPath, classField, classFieldType, classMethod, lookup, moduleMember, type Binding } from "./project.js";
import { withSubst, type IrCtx, type Seg, type Subst } from "./raw.js";
import { dictValue } from "./values.js";

export type Root =
  | { kind: "external" }
  /** A project function or method, not called yet. */
  | { kind: "function"; fn: FunctionDef }
  /** An instance of a project class (also `self` / `$this`). */
  | { kind: "instance"; cls: ClassDef }
  | { kind: "class"; cls: ClassDef }
  | { kind: "module"; mod: ModuleModel }
  /** An untyped parameter: whatever the caller passes. */
  | { kind: "param"; name: string }
  /** `self.x` with no known value or type. */
  | { kind: "field"; name: string }
  /** A name defined nowhere in the project: a builtin (`open`, `curl_init`). */
  | { kind: "global"; name: string }
  | { kind: "unknown" };

/** A value as a root and the members after it: `requests.Session().get` is external `[requests, Session(), get]`. */
export interface Chain {
  root: Root;
  segs: Seg[];
  viaType?: boolean;
}

const MAX_DEPTH = 10;
const UNKNOWN: Chain = { root: { kind: "unknown" }, segs: [] };

const resolved = (c: Chain): boolean => c.root.kind === "external" || c.root.kind === "instance" || c.root.kind === "class" || c.root.kind === "module" || c.root.kind === "function";

function bindingChain(b: Binding, name: string, ctx: IrCtx, depth: number): Chain {
  switch (b.kind) {
    case "param": {
      const sub = ctx.subst?.get(b.param);
      if (sub) return valueChain(sub.expr, sub.fn, ctx, depth + 1);
      // a default instance (`Client $http = new Client(['base_uri' => ...])`) says more than the type alone
      const dflt = b.param.default ? valueChain(b.param.default, b.fn, ctx, depth + 1) : UNKNOWN;
      if (resolved(dflt)) return dflt;
      const typed = b.param.type ? typeChain(b.param.type, b.fn, ctx, depth + 1) : UNKNOWN;
      return resolved(typed) ? typed : { root: { kind: "param", name }, segs: [] };
    }
    case "value": {
      const c = valueChain(b.assign.value, b.fn, ctx, depth + 1);
      if (resolved(c) || !b.assign.type) return c;
      const typed = typeChain(b.assign.type, b.fn, ctx, depth + 1);
      return resolved(typed) ? typed : c;
    }
    case "function":
      return { root: { kind: "function", fn: b.fn }, segs: [] };
    case "class":
      return { root: { kind: "class", cls: b.cls }, segs: [] };
    case "module":
      return { root: { kind: "module", mod: b.mod }, segs: [] };
    case "external":
      return { root: { kind: "external" }, segs: b.path.map((n) => ({ name: n })) };
    default:
      return { root: { kind: "global", name }, segs: [] };
  }
}

/** A declared type as an instance: `OpenAI` -> `[openai, OpenAI(typed)]`, a project class -> its instance. */
export function typeChain(type: Expr, fn: FunctionDef, ctx: IrCtx, depth = 0): Chain {
  const c = valueChain(type, fn, ctx, depth + 1);
  if (c.root.kind === "class" && c.segs.length === 0) return { root: { kind: "instance", cls: c.root.cls }, segs: [], viaType: true };
  if (c.root.kind !== "external" || c.segs.length === 0) return UNKNOWN;
  const last = c.segs[c.segs.length - 1]!;
  return { root: c.root, segs: [...c.segs.slice(0, -1), { ...last, typed: true }], viaType: true };
}

/** The first value of a field that resolves (`self.client = None` then `self.client = OpenAI()`), else its declared type. */
function fieldChain(cls: ClassDef, name: string, ctx: IrCtx, depth: number): Chain | undefined {
  let fallback: Chain | undefined;
  for (const f of classField(cls, name, ctx.idx)) {
    const c = valueChain(f.value, f.fn, ctx, depth + 1);
    if (resolved(c)) return c;
    fallback ??= c;
  }
  const type = classFieldType(cls, name, ctx.idx);
  if (type) {
    const typed = typeChain(type, cls.module.top, ctx, depth + 1);
    if (resolved(typed)) return typed;
  }
  return fallback;
}

/** An external base class (`class Api(requests.Session)`): inherited members are the base's. */
function externalBase(cls: ClassDef, ctx: IrCtx): Chain | undefined {
  for (const b of cls.bases) {
    const bind = baseBinding(b, cls, ctx.idx);
    if (bind.kind === "external") {
      const segs: Seg[] = bind.path.map((n) => ({ name: n }));
      segs[segs.length - 1] = { ...segs[segs.length - 1]!, typed: true };
      return { root: { kind: "external" }, segs, viaType: true };
    }
  }
  return undefined;
}

function memberOfClass(cls: ClassDef, name: string, isInstance: boolean, ctx: IrCtx, depth: number): Chain {
  const method = classMethod(cls, name, ctx.idx);
  if (method) return { root: { kind: "function", fn: method }, segs: [] };
  const field = fieldChain(cls, name, ctx, depth);
  if (field) return field;
  const base = externalBase(cls, ctx);
  if (base) return { ...base, segs: [...base.segs, { name }] };
  return isInstance ? { root: { kind: "field", name }, segs: [] } : UNKNOWN;
}

function member(c: Chain, name: string, ctx: IrCtx, depth: number): Chain {
  if (c.segs.length === 0) {
    if (c.root.kind === "module") return bindingChain(moduleMember(c.root.mod, name, ctx.idx), name, ctx, depth + 1);
    if (c.root.kind === "instance") return memberOfClass(c.root.cls, name, true, ctx, depth);
    if (c.root.kind === "class") return memberOfClass(c.root.cls, name, false, ctx, depth);
  }
  return { ...c, segs: [...c.segs, { name }] };
}

/** The call attached to the last member: `[requests, get]` + `get(...)` -> `[requests, get(...)]`. */
export function attach(c: Chain, call: CallExpr, fn: FunctionDef, subst: Subst | undefined): Chain {
  const last = c.segs[c.segs.length - 1];
  if (!last) return c;
  const seg: Seg = { name: last.call || last.typed ? "()" : last.name, call, fn, subst };
  return { ...c, segs: last.call || last.typed ? [...c.segs, seg] : [...c.segs.slice(0, -1), seg] };
}

/** What a project function returns, when it builds a client (`def get_client(): return OpenAI(...)`). */
function factoryResult(target: FunctionDef, call: CallExpr, fn: FunctionDef, ctx: IrCtx, depth: number): Chain {
  const subst: Subst = new Map();
  target.params.forEach((p) => {
    const arg = call.args.find((a) => a.name === p.name) ?? call.args.filter((a) => !a.name)[p.index];
    if (arg && !arg.spread) subst.set(p, { expr: arg.value, fn });
  });
  const inner = withSubst(ctx, subst);
  for (const ret of target.returns) {
    const c = valueChain(ret, target, inner, depth + 1);
    if (resolved(c)) return { ...c, segs: c.segs.map((s) => (s.call && !s.subst ? { ...s, subst: inner.subst } : s)) };
  }
  return UNKNOWN;
}

function callChain(e: CallExpr, fn: FunctionDef, ctx: IrCtx, depth: number): Chain {
  const c = valueChain(e.fn, fn, ctx, depth);
  if (c.segs.length === 0) {
    if (c.root.kind === "function") return factoryResult(c.root.fn, e, fn, ctx, depth);
    if (c.root.kind === "class") return { root: { kind: "instance", cls: c.root.cls }, segs: [] };
    return UNKNOWN;
  }
  return attach(c, e, fn, ctx.subst);
}

/** The value an expression stands for, as a chain. */
export function valueChain(e: Expr, fn: FunctionDef, ctx: IrCtx, depth = 0): Chain {
  if (depth > MAX_DEPTH) return UNKNOWN;
  switch (e.k) {
    case "name":
      return bindingChain(lookup(e.name, fn, e.pos.offset, ctx.idx), e.name, ctx, depth);
    case "qname":
      return bindingChain(bindingOfPath(e.path, ctx.idx), e.path.join("."), ctx, depth);
    case "this":
      return fn.cls ? { root: { kind: "instance", cls: fn.cls }, segs: [] } : UNKNOWN;
    case "fnref":
      return { root: { kind: "function", fn: e.fn }, segs: [] };
    // members and calls are structure (bounded by the expression); only lookups count against the depth
    case "attr":
      return member(valueChain(e.obj, fn, ctx, depth), e.name, ctx, depth);
    case "call":
      return callChain(e, fn, ctx, depth);
    case "index": {
      const v = dictValue(e, fn, ctx);
      return v ? valueChain(v.expr, v.fn, ctx, depth + 1) : UNKNOWN;
    }
    case "or":
    case "cond": {
      const [a, b] = e.k === "or" ? [e.left, e.right] : [e.then, e.else];
      const left = valueChain(a, fn, ctx, depth + 1);
      return resolved(left) ? left : valueChain(b, fn, ctx, depth + 1);
    }
    default:
      return UNKNOWN;
  }
}

/** What a call invokes: the callee's chain with the call on its last member (factories are not followed). */
export function calleeChain(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Chain {
  return attach(valueChain(call.fn, fn, ctx), call, fn, ctx.subst);
}
