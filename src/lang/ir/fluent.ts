import { appliedSteps } from "./applied.js";
import { mayNotRun } from "./edits.js";
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
const methodName = (c: CallExpr): string => (c.fn.k === "attr" || c.fn.k === "name" ? c.fn.name : "");

/** The entries `apply { put(k, v) }` lambdas run on the value add (Kotlin); other calls in them are not the map's. */
function applyLambdas(acc: Acc, call: CallExpr, into: FunctionDef): void {
  for (const c of appliedSteps(call.applied)) apply(acc, methodName(c.call), c.call, c.fn, into);
}

/** `map.remove("k")`, perhaps on some paths only: the key it removes is no longer a required one. */
function unset(acc: Acc, key: Expr): void {
  if (key.k !== "str") return;
  acc.entries = acc.entries.map((en) => (en.key?.k === "str" && en.key.v === key.v ? { ...en, optional: true } : en));
}

/** One call on the value: an entry, an item or an Authorization entry; false when the spec has no such method. */
/** `setMaxTokens` -> `max_tokens` under `setterCase`. */
function casedSetter(spec: FluentMapSpec, name: string): string | undefined {
  if (!spec.setterCase || !/^set[A-Z]/.test(name)) return undefined;
  return name.charAt(3).toLowerCase() + name.slice(4).replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function apply(acc: Acc, name: string, call: CallExpr, fn: FunctionDef, into: FunctionDef): boolean {
  const [a, b] = positional(call).map((x) => scopedIn(x, fn, into));
  const auth = acc.spec.auth?.[name];
  const setter = acc.spec.setters && Object.hasOwn(acc.spec.setters, name) ? acc.spec.setters[name] : casedSetter(acc.spec, name);
  if (setter && a) acc.entries.push({ key: { k: "str", v: setter }, value: a });
  else if (acc.spec.put?.includes(name) && a && b) acc.entries.push({ key: a, value: b });
  else if (acc.spec.items?.includes(name) && a) acc.items.push(a);
  else if (acc.spec.spread?.includes(name) && a) acc.entries.push({ value: a, spread: true });
  else if (acc.spec.remove?.includes(name) && a) unset(acc, positional(call)[0]!);
  else if (acc.spec.skip?.includes(name)) return true;
  else if (auth && a) acc.entries.push({ key: { k: "str", v: "Authorization" }, value: { k: "tmpl", parts: [{ k: "str", v: auth === "bearer" ? "Bearer " : "Basic " }, a] } });
  else return false;
  return true;
}

/** A call on a variable holding the value: an entry put in a branch or a loop (`if (x) o.setTemperature(t)`) may not be there. */
function step(acc: Acc, c: ScopedCall, optional: boolean, into: FunctionDef): void {
  const from = acc.entries.length;
  apply(acc, methodName(c.call), c.call, c.fn, into);
  applyLambdas(acc, c.call, into);
  if (optional) for (let i = from; i < acc.entries.length; i++) if (!acc.entries[i]!.spread) acc.entries[i] = { ...acc.entries[i]!, optional: true };
}

/** The entries of a dict written in `fn`, read in `into`. */
function entriesIn(dict: Expr, fn: FunctionDef, into: FunctionDef): Entry[] {
  if (dict.k !== "dict") return [];
  return dict.entries.map((en) => ({ ...en, value: scopedIn(en.value, fn, into), ...(en.key ? { key: scopedIn(en.key, fn, into) } : {}) }));
}

/** `ChatCompletionsOptions(messages)`: the constructor's positional arguments as the entries `args` names. */
function constructorEntries(names: string[], call: CallExpr, fn: FunctionDef, into: FunctionDef): Entry[] {
  return positional(call).flatMap((value, i) => (names[i] ? [{ key: { k: "str" as const, v: names[i] }, value: scopedIn(value, fn, into) }] : []));
}

/** The constructor call or variable a chain of calls starts from, and its value so far. */
function start(e: Expr, fn: FunctionDef, into: FunctionDef, ctx: IrCtx, depth: number): Acc | undefined {
  if (e.k === "call") {
    // an object filled by setters (SendGrid's `Request()`) is made empty: `Request(url)` is another library's
    const spec = ctx.idx.lang.fluentMaps!.find((s) => namesEnd(e.fn, s.objects) && (!s.setters || e.args.length === 0));
    if (spec?.args) return { spec, entries: constructorEntries(spec.args, e, fn, into), items: [] };
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
  acc.entries.push(...entriesIn(inner.expr, inner.fn, into));
  if (inner.expr.k === "list") acc.items.push(...inner.expr.items.map((i) => scopedIn(i, inner.fn, into)));
  const before = (offset: number): boolean => offset < e.pos.offset || b.fn !== fn;
  const steps: { at: number; run: () => void }[] = callsOn(b.fn, e.name, b.assign.offset)
    .filter((c) => before(c.call.pos.offset))
    .map((c) => ({ at: c.call.pos.offset, run: () => step(acc, c, mayNotRun(b.fn, c.call.pos.offset, b.fn === fn ? e.pos.offset : undefined), into) }));
  // `body["k"] = v` (Kotlin, lowered as an edit): an entry put on the map, in order with the calls
  const sets = acc.spec.put ? b.fn.assigns.filter((a) => a.edit === "merge" && a.target === e.name && a.offset > b.assign.offset && before(a.offset)) : [];
  for (const a of sets) {
    const optional = mayNotRun(b.fn, a.offset, b.fn === fn ? e.pos.offset : undefined);
    steps.push({ at: a.offset, run: () => void acc.entries.push(...entriesIn(a.value, b.fn, into).map((en) => (optional ? { ...en, optional } : en))) });
  }
  for (const s of steps.sort((x, y) => x.at - y.at)) s.run();
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
  if (cur.k === "call") applyLambdas(acc, cur, fn);
  for (const s of steps) {
    if (!apply(acc, methodName(s), s, fn, fn)) return undefined;
    applyLambdas(acc, s, fn);
  }
  // the calls on a variable holding it come after: only the value as it is read is complete
  if (complete && acc.spec.filledOnly && acc.entries.length === 0) return undefined;
  const expr: Expr = acc.spec.items ? { k: "list", items: acc.items } : { k: "dict", entries: acc.entries };
  return { spec: acc.spec, expr, fn };
}
