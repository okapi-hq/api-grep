import type { FluentMapSpec } from "./language.js";
import { dottedPath, type CallExpr, type Entry, type Expr, type FunctionDef } from "./model.js";
import { lookup } from "./project.js";
import type { IrCtx } from "./raw.js";

const MAX_DEPTH = 4;

/** A call and the function it is written in. */
export interface ScopedCall {
  call: CallExpr;
  fn: FunctionDef;
}

/**
 * Calls made on a variable after `after` (an offset), in its function and in the closures written there:
 * `b.header(...)` after `val b = Request.Builder()`, in source order.
 */
export function callsOn(fn: FunctionDef, name: string, after: number): ScopedCall[] {
  const fns = [fn, ...fn.module.allFunctions.filter((f) => f.parent === fn)];
  const out: ScopedCall[] = [];
  for (const f of fns) {
    for (const c of f.calls) if (c.fn.k === "attr" && c.fn.obj.k === "name" && c.fn.obj.name === name && c.pos.offset > after) out.push({ call: c, fn: f });
  }
  return out.sort((a, b) => a.call.pos.offset - b.call.pos.offset);
}

/** `x` where `x` is read in `from` while written in `fn`. */
export function scopedIn(e: Expr, fn: FunctionDef, from: FunctionDef): Expr {
  return fn === from ? e : { k: "scoped", expr: e, fn };
}

/** Whether a constructor as written (`FormBody.Builder`, `okhttp3.FormBody.Builder`) ends with `name`. */
export function namesEnd(callee: Expr, names: string[]): boolean {
  const path = dottedPath(callee)?.join(".");
  return !!path && names.some((n) => path === n || path.endsWith(`.${n}`));
}

export interface FluentValue {
  spec: FluentMapSpec;
  /** A dict, or a list for item builders, read in `fn`. */
  expr: Expr;
  fn: FunctionDef;
}

interface Acc {
  spec: FluentMapSpec;
  entries: Entry[];
  items: Expr[];
}

const positional = (c: CallExpr): Expr[] => c.args.filter((a) => !a.name && !a.spread).map((a) => a.value);
const methodName = (c: CallExpr): string => (c.fn.k === "attr" ? c.fn.name : "");

/** `map.remove("k")`, perhaps on some paths only: the key it removes is no longer a required one. */
function unset(acc: Acc, key: Expr): void {
  if (key.k !== "str") return;
  acc.entries = acc.entries.map((en) => (en.key?.k === "str" && en.key.v === key.v ? { ...en, optional: true } : en));
}

/** One call on the value: an entry, an item or an Authorization entry; false when the spec has no such method. */
function apply(acc: Acc, name: string, call: CallExpr, fn: FunctionDef, into: FunctionDef): boolean {
  const [a, b] = positional(call).map((x) => scopedIn(x, fn, into));
  const auth = acc.spec.auth?.[name];
  if (acc.spec.put?.includes(name) && a && b) acc.entries.push({ key: a, value: b });
  else if (acc.spec.items?.includes(name) && a) acc.items.push(a);
  else if (acc.spec.spread?.includes(name) && a) acc.entries.push({ value: a, spread: true });
  else if (acc.spec.remove?.includes(name) && a) unset(acc, positional(call)[0]!);
  else if (acc.spec.skip?.includes(name)) return true;
  else if (auth && a) acc.entries.push({ key: { k: "str", v: "Authorization" }, value: { k: "tmpl", parts: [{ k: "str", v: auth === "bearer" ? "Bearer " : "Basic " }, a] } });
  else return false;
  return true;
}

/** The constructor call or variable a chain of calls starts from, and its value so far. */
function start(e: Expr, fn: FunctionDef, into: FunctionDef, ctx: IrCtx, depth: number): Acc | undefined {
  if (e.k === "call") {
    const spec = ctx.idx.lang.fluentMaps!.find((s) => namesEnd(e.fn, s.objects));
    const arg = positional(e)[0];
    // `JSONObject(mapOf(...))`: the map's entries first; `HashMap(16)` is a capacity
    return spec ? { spec, entries: arg && !spec.items && arg.k !== "num" ? [{ value: scopedIn(arg, fn, into), spread: true }] : [], items: [] } : undefined;
  }
  if (e.k !== "name" || depth > MAX_DEPTH) return undefined;
  const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
  if (b.kind !== "value" || b.assign.augmented) return undefined;
  const inner = fluentMap(b.assign.value, b.fn, ctx, depth + 1, false);
  if (!inner) return undefined;
  const acc: Acc = { spec: inner.spec, entries: [], items: [] };
  if (inner.expr.k === "dict") acc.entries.push(...inner.expr.entries.map((en) => ({ ...en, value: scopedIn(en.value, inner.fn, into), ...(en.key ? { key: scopedIn(en.key, inner.fn, into) } : {}) })));
  if (inner.expr.k === "list") acc.items.push(...inner.expr.items.map((i) => scopedIn(i, inner.fn, into)));
  for (const c of callsOn(b.fn, e.name, b.assign.offset)) if (c.call.pos.offset < e.pos.offset || b.fn !== fn) apply(acc, methodName(c.call), c.call, c.fn, into);
  for (const [prop, entry] of Object.entries(acc.spec.props ?? {})) {
    const set = b.fn.assigns.find((a) => a.target === `${e.name}.${prop}` && a.offset > b.assign.offset);
    if (set) acc.entries.push({ key: { k: "str", v: entry }, value: scopedIn(set.value, b.fn, into) });
  }
  return acc;
}

/**
 * The value a chain of calls builds entry by entry (`JSONObject().put("a", 1).put("b", x).toString()`), as a dict
 * or a list read in `fn`; undefined when the expression is not one (or uses a method the spec does not list).
 */
export function fluentMap(e: Expr, fn: FunctionDef, ctx: IrCtx, depth = 0, complete = true): FluentValue | undefined {
  if (!ctx.idx.lang.fluentMaps || (e.k !== "call" && e.k !== "name")) return undefined;
  const specs = ctx.idx.lang.fluentMaps;
  const steps: CallExpr[] = [];
  let cur: Expr = e;
  while (cur.k === "call" && cur.fn.k === "attr") {
    const callee: Extract<Expr, { k: "attr" }> = cur.fn;
    if (specs.some((s) => namesEnd(callee, s.objects))) break;
    steps.unshift(cur);
    cur = callee.obj;
  }
  const acc = start(cur, fn, fn, ctx, depth);
  if (!acc) return undefined;
  const pass = ctx.idx.lang.passthrough.methods;
  // `.build()`, `.toString()` at the end hand back what was built
  while (steps.length > 0 && ["build", ...pass].includes(methodName(steps[steps.length - 1]!))) steps.pop();
  for (const s of steps) if (!apply(acc, methodName(s), s, fn, fn)) return undefined;
  // the calls on a variable holding it come after: only the value as it is read is complete
  if (complete && acc.spec.filledOnly && acc.entries.length === 0) return undefined;
  const expr: Expr = acc.spec.items ? { k: "list", items: acc.items } : { k: "dict", entries: acc.entries };
  return { spec: acc.spec, expr, fn };
}
