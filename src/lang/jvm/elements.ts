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
const EACH = new Set(["forEach", "onEach"]);

/** `interceptors.forEach { addInterceptor(it) }`: the collection whose elements the lambda's parameter is. */
function iterated(e: Expr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (e.k !== "name") return undefined;
  const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
  if (b.kind !== "param" || b.param.index !== 0 || !b.fn.parent) return undefined;
  const lambda = b.fn;
  const parent = b.fn.parent;
  const call = parent.calls.find((c) => c.fn.k === "attr" && EACH.has(c.fn.name) && c.args.some((a) => a.value.k === "fnref" && a.value.fn === lambda));
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
