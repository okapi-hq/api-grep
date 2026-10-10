import type { Scoped } from "./language.js";
import type { Entry, Expr, FunctionDef } from "./model.js";
import { classField, lookup, receiverClass } from "./project.js";
import type { IrCtx } from "./raw.js";

const MAX_DEPTH = 8;

/**
 * The expression a name stands for: a variable's value, a wrapper parameter's argument, a field's value. Stops at
 * anything else (a literal, a call, an untyped parameter).
 */
export function deref(e: Expr, fn: FunctionDef, ctx: IrCtx, depth = 0): Scoped {
  if (depth > MAX_DEPTH) return { expr: e, fn };
  if (e.k === "name") {
    const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
    if (b.kind === "value" && !b.assign.augmented) return deref(b.assign.value, b.fn, ctx, depth + 1);
    if (b.kind === "param") {
      const sub = ctx.subst?.get(b.param);
      if (sub) return deref(sub.expr, sub.fn, ctx, depth + 1);
    }
  }
  if (e.k === "attr" && e.obj.k === "this" && fn.cls) {
    const values = classField(receiverClass(fn, ctx.self, ctx.idx)!, e.name, ctx.idx);
    if (values.length === 1) return deref(values[0]!.value, values[0]!.fn, ctx, depth + 1);
  }
  if (e.k === "call") {
    const resolved = ctx.idx.lang.resolveCall?.(e, fn, ctx);
    if (resolved) return deref(resolved.expr, resolved.fn, ctx, depth + 1);
  }
  if (e.k === "or") {
    const left = deref(e.left, fn, ctx, depth + 1);
    return left.expr.k === "dict" ? left : deref(e.right, fn, ctx, depth + 1);
  }
  return { expr: e, fn };
}

/** A key written as a literal (or a constant holding one). */
export function staticKey(e: Expr | undefined, fn: FunctionDef, ctx: IrCtx): string | undefined {
  if (!e) return undefined;
  const d = deref(e, fn, ctx);
  if (d.expr.k === "str") return d.expr.v;
  if (d.expr.k === "num") return String(d.expr.v);
  return undefined;
}

/** The dict / associative array literal an expression stands for. */
export function dictOf(e: Expr, fn: FunctionDef, ctx: IrCtx): { entries: Entry[]; fn: FunctionDef } | undefined {
  const d = deref(e, fn, ctx);
  return d.expr.k === "dict" ? { entries: d.expr.entries, fn: d.fn } : undefined;
}

/** The value of `key` in a dict literal, also through `**spread` of another literal. */
export function entryOf(dict: { entries: Entry[]; fn: FunctionDef }, key: string, ctx: IrCtx, depth = 0): Scoped | undefined {
  let found: Scoped | undefined;
  for (const en of dict.entries) {
    if (en.spread) {
      const inner = depth < 3 ? dictOf(en.value, dict.fn, ctx) : undefined;
      const hit = inner ? entryOf(inner, key, ctx, depth + 1) : undefined;
      if (hit) found = hit;
      continue;
    }
    if (staticKey(en.key, dict.fn, ctx) === key) found = { expr: en.value, fn: dict.fn };
  }
  return found;
}

/** `CONFIG["base"]`, `$config['base']`: the entry of a dict literal behind the indexed value. */
export function dictValue(e: Expr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (e.k !== "index") return undefined;
  const key = staticKey(e.key, fn, ctx);
  const dict = key !== undefined ? dictOf(e.obj, fn, ctx) : undefined;
  return dict && key !== undefined ? entryOf(dict, key, ctx) : undefined;
}
