import { cachedEntries, sameExpr } from "./cache.js";
import { extensionFor, libraryExtension } from "./extensions.js";
import type { Scoped } from "./language.js";
import { argFor, posOf, receiverArg, type CallExpr, type ClassDef, type Expr, type FunctionDef, type ModuleModel, type Param } from "./model.js";
import { overloadFor, overloadsFor } from "./overloads.js";
import { baseBinding, bindingOfPath, classField, classFieldType, classMethod, lookup, moduleMember, receiverClass, type Binding } from "./project.js";
import { injectedCall, injectedField, paramValue } from "./injected.js";
import { withSubst, type IrCtx, type Seg, type Subst } from "./raw.js";
import { dictValue, staticKey } from "./values.js";

export type Root =
  | { kind: "external" }
  /** A project function or method, not called yet. */
  | { kind: "function"; fn: FunctionDef }
  /** An instance of a project class (also `self` / `$this`). */
  | { kind: "instance"; cls: ClassDef }
  | { kind: "class"; cls: ClassDef }
  | { kind: "module"; mod: ModuleModel }
  /** An untyped parameter: whatever the caller passes. */
  | { kind: "param"; name: string; param?: Param; fn?: FunctionDef }
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
  /** A call of an overloaded method: the one it runs is not the first declared of its name. */
  overloaded?: boolean;
  /** A call whose arguments fit several overloads: each one it may run (the chain itself is unknown). */
  overloads?: FunctionDef[];
  /**
   * Other values the factory the chain starts from may return (`return Anthropic() if claude else OpenAI()`), with the
   * same members after them: an SDK call is the one whose registry has the method.
   */
  alternatives?: Chain[];
}

const MAX_DEPTH = 10;
/** Values of a factory with several returns kept as alternatives: a bound on hostile input. */
const MAX_ALTERNATIVES = 4;
const UNKNOWN: Chain = { root: { kind: "unknown" }, segs: [] };

const resolved = (c: Chain): boolean => c.root.kind === "external" || c.root.kind === "instance" || c.root.kind === "class" || c.root.kind === "module" || c.root.kind === "function";

function bindingChain(b: Binding, name: string, ctx: IrCtx, depth: number): Chain {
  switch (b.kind) {
    case "param": {
      const sub = paramValue(b.param, b.fn, ctx);
      if (sub) return valueChain(sub.expr, sub.fn, ctx, depth + 1);
      // a default instance (`Client $http = new Client(['base_uri' => ...])`) says more than the type alone
      const dflt = b.param.default ? valueChain(b.param.default, b.fn, ctx, depth + 1) : UNKNOWN;
      if (resolved(dflt)) return dflt;
      const typed = b.param.type ? typeChain(b.param.type, b.fn, ctx, depth + 1) : UNKNOWN;
      if (resolved(typed)) return typed;
      // `cache: MutableMap<...>` in a typed language: a value the type names, not a client received from outside
      return b.param.type && ctx.idx.lang.typedParams ? UNKNOWN : { root: { kind: "param", name, param: b.param, fn: b.fn }, segs: [] };
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
/** Fields being resolved: `account = account.copy(...)` assigned in many places would otherwise branch at every level. */
const resolving = new WeakMap<ClassDef, Set<string>>();

/** The values of a field that resolve to something, read once per field along a chain (a value reading the field itself is skipped). */
function fieldValues(cls: ClassDef, name: string, ctx: IrCtx, depth: number): { resolved?: Chain; fallback?: Chain } {
  const open = resolving.get(cls) ?? new Set<string>();
  if (open.has(name)) return {};
  resolving.set(cls, open.add(name));
  try {
    let fallback: Chain | undefined;
    const found: Chain[] = [];
    for (const f of classField(cls, name, ctx.idx)) {
      const c = valueChain(f.value, f.fn, ctx, depth + 1);
      if (resolved(c)) found.push(c);
      else fallback ??= c;
      // the first value decides unless it is a client: others of other SDKs are its alternatives
      if (found.length >= MAX_ALTERNATIVES || (found.length === 1 && found[0]!.root.kind !== "external")) break;
    }
    return found.length > 0 ? { resolved: withAlternatives(found) } : { fallback };
  } finally {
    open.delete(name);
  }
}

function fieldChain(cls: ClassDef, name: string, ctx: IrCtx, depth: number): Chain | undefined {
  const { resolved: value, fallback } = fieldValues(cls, name, ctx, depth);
  if (value) return value;
  // `@Autowired private RestTemplate rest;`: what the container injects
  const injected = fallback ? undefined : injectedField(cls, name, ctx);
  const inj = injected ? valueChain(injected.expr, injected.fn, ctx, depth + 1) : undefined;
  if (inj && resolved(inj)) return inj;
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
  // `self.client` read through a `@property`: what it returns (a client it builds once)
  if (method?.isProperty && isInstance) return factoryResult(method, { k: "call", fn: { k: "fnref", fn: method }, args: [], pos: method.pos }, method, ctx, depth);
  if (method) return { root: { kind: "function", fn: method }, segs: [] };
  const field = fieldChain(cls, name, ctx, depth);
  if (field) return field;
  const base = externalBase(cls, ctx);
  if (base) return { ...base, segs: [...base.segs, { name }] };
  return isInstance ? { root: { kind: "field", name }, segs: [] } : UNKNOWN;
}

/** A member of a value; `from` (the code reading it) sees the extension functions in its scope (Kotlin, #86). */
function member(c: Chain, name: string, ctx: IrCtx, depth: number, from?: FunctionDef): Chain {
  const ext = from && (c.root.kind !== "instance" || !classMethod(c.root.cls, name, ctx.idx)) ? extensionFor(c, name, from, ctx) : undefined;
  if (ext) return { root: { kind: "function", fn: ext }, segs: [] };
  if (c.segs.length === 0) {
    if (c.root.kind === "module") return bindingChain(moduleMember(c.root.mod, name, ctx.idx), name, ctx, depth + 1);
    if (c.root.kind === "instance") return memberOfClass(c.root.cls, name, true, ctx, depth);
    if (c.root.kind === "class") return memberOfClass(c.root.cls, name, false, ctx, depth);
  }
  return { ...c, segs: [...c.segs, { name }], ...(c.alternatives ? { alternatives: c.alternatives.map((a) => member(a, name, ctx, depth, from)) } : {}) };
}

/**
 * A bare name in an extension function that nothing in the project declares: a member of its receiver (`headBucket(...)`
 * on `S3Client`), also when it is an extension the receiver's library defines (Ktor's `get(url)` on `HttpClient`).
 */
function implicitMember(e: Extract<Expr, { k: "name" }>, b: Binding, fn: FunctionDef, ctx: IrCtx, depth: number): Chain | undefined {
  if (b.kind !== "none" && b.kind !== "external") return undefined;
  const receiver = valueChain({ k: "name", name: "this", pos: e.pos }, fn, ctx, depth + 1);
  if (!resolved(receiver) || (b.kind === "external" && !libraryExtension(b.path, receiver))) return undefined;
  return member(receiver, e.name, ctx, depth, fn);
}

/** The call attached to the last member: `[requests, get]` + `get(...)` -> `[requests, get(...)]`. */
export function attach(c: Chain, call: CallExpr, fn: FunctionDef, subst: Subst | undefined): Chain {
  const last = c.segs[c.segs.length - 1];
  if (!last) return c;
  const seg: Seg = { name: last.call || last.typed ? "()" : last.name, call, fn, subst };
  const alternatives = c.alternatives?.map((a) => attach(a, call, fn, subst));
  return { ...c, segs: last.call || last.typed ? [...c.segs, seg] : [...c.segs.slice(0, -1), seg], ...(alternatives ? { alternatives } : {}) };
}

/** What a project function returns, when it builds a client (`def get_client(): return OpenAI(...)`). */
function factoryResult(target: FunctionDef, call: CallExpr, fn: FunctionDef, ctx: IrCtx, depth: number): Chain {
  const subst: Subst = new Map();
  target.params.forEach((p) => {
    const arg = argFor(call, p);
    if (arg) subst.set(p, { expr: arg.value, fn });
  });
  if (target.receiver) subst.set(target.receiver, { expr: receiverArg(call), fn });
  const inner = withSubst(ctx, subst);
  const found: Chain[] = [];
  for (const ret of target.returns) {
    const c = valueChain(ret, target, inner, depth + 1);
    if (resolved(c)) found.push({ ...c, segs: c.segs.map((s) => (s.call && !s.subst ? { ...s, subst: inner.subst } : s)) });
    if (found.length >= MAX_ALTERNATIVES) break;
  }
  return found.length === 0 ? UNKNOWN : withAlternatives(found);
}

/**
 * The first of several values (a factory's returns, a field's assignments), the clients among the others kept as
 * its `alternatives`: the method called on it tells which SDK's it is.
 */
function withAlternatives(found: Chain[]): Chain {
  const first = found[0]!;
  const others = first.root.kind === "external" ? found.slice(1).filter((c) => c.root.kind === "external") : [];
  return others.length > 0 ? { ...first, alternatives: [...(first.alternatives ?? []), ...others] } : first;
}

/** Kotlin `postgrest["table"]` on a library object: its `get` operator, `postgrest.get("table")`. */
function indexCall(e: Extract<Expr, { k: "index" }>, name: string, fn: FunctionDef, ctx: IrCtx, depth: number): Chain {
  const obj = valueChain(e.obj, fn, ctx, depth);
  // an SDK object only: a list or an array element keeps the declared type of the variable it is read into
  const path = obj.segs.map((s) => s.name).join(".");
  const sdk = ctx.idx.lang.registry.some((r) => r.imports.some((i) => path === i || path.startsWith(`${i}.`)));
  if (obj.root.kind !== "external" || !sdk || fn.module.language === "java") return UNKNOWN;
  const pos = posOf(e.obj) ?? fn.pos;
  const call: CallExpr = { k: "call", fn: { k: "attr", obj: e.obj, name, pos }, args: [{ value: e.key }], pos };
  return attach(member(obj, name, ctx, depth), call, fn, ctx.subst);
}

/**
 * A client read from a module's dict a helper fills (#98): the one every value written into it is, else the first with
 * the others kept on its construction, for the endpoint to say whether they agree.
 */
function cacheChain(values: Scoped[], keyed: boolean, ctx: IrCtx, depth: number): Chain {
  // the same construction written twice (in both branches) is one client
  const distinct = values.filter((v, i) => values.findIndex((w) => w.fn === v.fn && sameExpr(w.expr, v.expr)) === i);
  const chains = distinct.map((v) => valueChain(v.expr, v.fn, ctx, depth + 1));
  const first = chains[0]!;
  if (!chains.every(resolved)) return UNKNOWN;
  const last = first.segs.at(-1);
  const others = chains.slice(1).map((c) => c.segs.at(-1));
  if (!last?.call || others.some((o) => !o?.call)) return chains.length === 1 && !keyed ? first : UNKNOWN;
  return { ...first, segs: [...first.segs.slice(0, -1), { ...last, cache: { others: others as Seg[], keyed } }] };
}

function callChain(e: CallExpr, fn: FunctionDef, ctx: IrCtx, depth: number): Chain {
  const cached = e.fn.k === "attr" && e.fn.name === "get" ? cachedEntries(e, fn, ctx) : undefined;
  if (cached) return cacheChain(cached, staticKey(e.args[0]?.value, fn, ctx) === undefined, ctx, depth);
  const made = ctx.idx.lang.instanceOf?.(e, fn, ctx, depth);
  if (made) return { root: { kind: "instance", cls: made }, segs: [] };
  // `get<HttpClient>()`, `by inject()`: the container's binding
  const injected = injectedCall(e, fn, ctx);
  if (injected) return valueChain(injected.expr, injected.fn, ctx, depth + 1);
  // a bean the framework makes (`ref<ChatClient>()` of a starter): a value of the type it names
  const looked = ctx.idx.lang.injection?.lookupType?.(e, fn, ctx);
  if (looked) return typeChain(looked, fn, ctx, depth + 1);
  const c = valueChain(e.fn, fn, ctx, depth);
  if (c.segs.length === 0) {
    const target = c.root.kind === "function" ? overloadFor(c.root.fn, e, fn, ctx) : undefined;
    if (c.root.kind === "function") return target ? factoryResult(target, e, fn, ctx, depth) : UNKNOWN;
    if (c.root.kind === "class") return { root: { kind: "instance", cls: c.root.cls }, segs: [] };
    return UNKNOWN;
  }
  return attach(c, e, fn, ctx.subst);
}

/** The value an expression stands for, as a chain. */
export function valueChain(e: Expr, fn: FunctionDef, ctx: IrCtx, depth = 0): Chain {
  if (depth > MAX_DEPTH) return UNKNOWN;
  switch (e.k) {
    case "name": {
      const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
      return (e.implicit && implicitMember(e, b, fn, ctx, depth)) || bindingChain(b, e.name, ctx, depth);
    }
    case "qname":
      return bindingChain(bindingOfPath(e.path, ctx.idx), e.path.join("."), ctx, depth);
    case "this": {
      const cls = receiverClass(fn, ctx.self, ctx.idx);
      return cls ? { root: { kind: "instance", cls }, segs: [] } : UNKNOWN;
    }
    case "fnref":
      return { root: { kind: "function", fn: e.fn }, segs: [] };
    case "scoped":
      return valueChain(e.expr, e.fn, ctx, depth + 1);
    // members and calls are structure (bounded by the expression); only lookups count against the depth
    case "attr":
      return member(valueChain(e.obj, fn, ctx, depth), e.name, ctx, depth, fn);
    case "call":
      return callChain(e, fn, ctx, depth);
    case "index": {
      const v = dictValue(e, fn, ctx);
      if (v) return valueChain(v.expr, v.fn, ctx, depth + 1);
      const cached = cachedEntries(e, fn, ctx);
      if (cached) return cacheChain(cached, staticKey(e.key, fn, ctx) === undefined, ctx, depth);
      return ctx.idx.lang.indexOperator ? indexCall(e, ctx.idx.lang.indexOperator, fn, ctx, depth) : UNKNOWN;
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
  const c = valueChain(call.fn, fn, ctx);
  if (c.root.kind !== "function" || c.segs.length > 0) return attach(c, call, fn, ctx.subst);
  // an overloaded method: the one the arguments fit, else not known
  const options = overloadsFor(c.root.fn, call, fn, ctx);
  const target = options.length === 1 ? options[0]! : undefined;
  if (target) return { root: { kind: "function", fn: target }, segs: [], ...(target !== c.root.fn ? { overloaded: true } : {}) };
  return options.length > 1 ? { ...UNKNOWN, overloads: options } : UNKNOWN;
}
