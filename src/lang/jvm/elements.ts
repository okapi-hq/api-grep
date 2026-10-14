import type { Scoped } from "../ir/language.js";
import type { Expr, FunctionDef } from "../ir/model.js";
import { lookup } from "../ir/project.js";
import type { IrCtx } from "../ir/raw.js";
import { deref } from "../ir/values.js";

/**
 * The values a collection stands for, where one interceptor or filter is expected (#75): the items of a list (`listOf(a,
 * b)`, a multibinding the container injects), the element a `forEach` lambda receives, else the value itself.
 */

const MAX_DEPTH = 4;
/** Calls running a lambda per element, and the parameter the element is (`fold(init) { acc, x -> ... }`: the second). */
const EACH: Record<string, number> = { forEach: 0, onEach: 0, fold: 1 };

/** A loop variable (`for (Interceptor i : interceptors)`): the collection it goes over. */
function looped(e: Expr & { k: "name" }, fn: FunctionDef): Scoped | undefined {
  for (let f: FunctionDef | undefined = fn; f; f = f.parent) {
    // assigned in the loop, the variable is no longer the element
    if (f === fn && f.assigns.some((a) => a.target === e.name && a.offset < e.pos.offset)) return undefined;
    const loop = f.loops?.find((l) => l.name === e.name && l.from <= e.pos.offset && e.pos.offset < l.to);
    if (loop) return { expr: loop.over, fn: f };
    if (f.params.some((p) => p.name === e.name)) return undefined;
  }
  return undefined;
}

/**
 * `interceptors.forEach { addInterceptor(it) }`, `interceptors.fold(this) { b, i -> b.addInterceptor(i) }`, `for (i in
 * interceptors)`: the collection whose elements the name is.
 */
function iterated(e: Expr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (e.k !== "name") return undefined;
  const loop = looped(e, fn);
  if (loop) return loop;
  const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
  if (b.kind !== "param" || !b.fn.parent) return undefined;
  const lambda = b.fn;
  const parent = b.fn.parent;
  const call = parent.calls.find((c) => c.fn.k === "attr" && Object.hasOwn(EACH, c.fn.name) && EACH[c.fn.name] === b.param.index && c.args.some((a) => a.value.k === "fnref" && a.value.fn === lambda));
  return call?.fn.k === "attr" ? { expr: call.fn.obj, fn: parent } : undefined;
}

export function elementsOf(s: Scoped, ctx: IrCtx, depth = 0): Scoped[] {
  if (depth > MAX_DEPTH) return [s];
  const each = iterated(s.expr, s.fn, ctx);
  if (each) return elementsOf(each, ctx, depth + 1);
  const d = deref(s.expr, s.fn, ctx);
  if (d.expr.k === "list") return d.expr.items.flatMap((i) => elementsOf({ expr: i, fn: d.fn }, ctx, depth + 1));
  return [s];
}
