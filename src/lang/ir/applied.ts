import type { ScopedCall } from "./fluent.js";
import { children, type CallExpr, type Expr, type FunctionDef } from "./model.js";

/** Lambdas of builder calls: Ktor `get(url) { ... }`, Kotlin `apply { ... }` on a builder. */

/** The lambda a call ends with (`get(url) { ... }`, `headers { ... }`). */
export function lambdaOf(call: CallExpr): FunctionDef | undefined {
  const last = call.args[call.args.length - 1]?.value;
  return last?.k === "fnref" ? last.fn : undefined;
}

/** The calls a lambda makes, in order (`parameter(...)`, `header(...)`, `it.setBearerAuth(...)`). */
export const lambdaCalls = (fn: FunctionDef): ScopedCall[] => [...fn.calls].sort((a, b) => a.pos.offset - b.pos.offset).map((call) => ({ call, fn }));

/** Calls of a lambda that are not inside another call's arguments (`url(u)`, not `token()` in `header(k, token())`). */
function outerCalls(fn: FunctionDef): CallExpr[] {
  const inner = new Set<Expr>();
  const walk = (e: Expr): void => {
    if (e.k === "call") inner.add(e);
    if (e.k !== "fnref" && e.k !== "scoped") children(e).forEach(walk);
  };
  for (const c of fn.calls) c.args.forEach((a) => walk(a.value));
  return fn.calls.filter((c) => !inner.has(c));
}

/**
 * The calls of `apply { ... }` / `also { ... }` lambdas made on the value: bare (`url(u)`), on `this` or on the
 * lambda's parameter (`it.url(u)`), in order.
 */
export function appliedSteps(lambdas: FunctionDef[] | undefined): ScopedCall[] {
  const out: ScopedCall[] = [];
  for (const fn of lambdas ?? []) {
    const it = fn.params[0]?.name;
    const outer = new Set(outerCalls(fn));
    const own = (c: CallExpr): boolean => c.fn.k === "name" || (c.fn.k === "attr" && (c.fn.obj.k === "this" || (c.fn.obj.k === "name" && c.fn.obj.name === it)));
    const steps = [...lambdaCalls(fn).filter((c) => own(c.call) && outer.has(c.call)), ...eachSteps(fn)];
    out.push(...steps.sort((a, b) => a.call.pos.offset - b.call.pos.offset));
  }
  return out;
}

/**
 * Steps made once per element of a collection (#75): `interceptors.forEach { addInterceptor(it) }` (the bare calls of
 * the lambda) and `interceptors.forEach(::addInterceptor)` (a call of the reference with each element, a spread).
 */
function eachSteps(fn: FunctionDef): ScopedCall[] {
  const out: ScopedCall[] = [];
  for (const c of fn.calls) {
    if (c.fn.k !== "attr" || c.fn.name !== "forEach") continue;
    const arg = c.args[0]?.value;
    if (arg?.k === "fnref") out.push(...lambdaCalls(arg.fn).filter((x) => x.call.fn.k === "name"));
    else if (arg?.k === "name") out.push({ call: { k: "call", fn: arg, args: [{ value: c.fn.obj, spread: "list" }], pos: c.pos }, fn });
  }
  return out;
}

/** Each step followed by the steps of the `apply { ... }` lambdas run on its value (`b.apply { ... }` on a variable too). */
export const expandApplied = (steps: ScopedCall[]): ScopedCall[] => steps.flatMap((c) => [c, ...appliedSteps(c.call.applied)]);

