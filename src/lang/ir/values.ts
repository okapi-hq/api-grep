import type { Scoped } from "./language.js";
import { dottedPath, type Entry, type Expr, type FunctionDef } from "./model.js";
import { fluentMap } from "./fluent.js";
import { classField, lookup, receiverClass } from "./project.js";
import { injectedCall, injectedField, paramValue } from "./injected.js";
import type { IrCtx } from "./raw.js";

const MAX_DEPTH = 8;

/** `MediaType.APPLICATION_JSON`, `org.springframework.http.MediaType.APPLICATION_JSON`: a library constant the language lists. */
export function knownConstant(e: Expr, ctx: IrCtx): string | undefined {
  const path = ctx.idx.lang.constants && (e.k === "attr" || e.k === "qname") ? dottedPath(e) : undefined;
  return path ? constantAt(path, ctx) : undefined;
}

/** The library constant a dotted path ends with (`javax.ws.rs.HttpMethod.GET`, also imported by name: `import static`). */
export function constantAt(path: string[], ctx: IrCtx): string | undefined {
  const table = ctx.idx.lang.constants;
  if (!table) return undefined;
  for (let i = 0; i < path.length - 1; i++) {
    const v = table[path.slice(i).join(".")];
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * The expression a name stands for: a variable's value, a wrapper parameter's argument, a field's value. Stops at
 * anything else (a literal, a call, an untyped parameter).
 */
export function deref(e: Expr, fn: FunctionDef, ctx: IrCtx, depth = 0): Scoped {
  if (depth > MAX_DEPTH) return { expr: e, fn };
  if (e.k === "scoped") return deref(e.expr, e.fn, ctx, depth + 1);
  const constant = knownConstant(e, ctx);
  if (constant !== undefined) return { expr: { k: "str", v: constant }, fn };
  if (e.k === "name") {
    const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
    if (b.kind === "value" && !b.assign.augmented) return deref(b.assign.value, b.fn, ctx, depth + 1);
    const imported = b.kind === "external" ? constantAt(b.path, ctx) : undefined;
    if (imported !== undefined) return { expr: { k: "str", v: imported }, fn };
    if (b.kind === "param") {
      const sub = paramValue(b.param, b.fn, ctx);
      if (sub) return deref(sub.expr, sub.fn, ctx, depth + 1);
    }
  }
  if (e.k === "attr" && e.obj.k === "this" && fn.cls) {
    const cls = receiverClass(fn, ctx.self, ctx.idx)!;
    const values = classField(cls, e.name, ctx.idx);
    if (values.length === 1) return deref(values[0]!.value, values[0]!.fn, ctx, depth + 1);
    const injected = values.length === 0 ? injectedField(cls, e.name, ctx) : undefined;
    if (injected) return deref(injected.expr, injected.fn, ctx, depth + 1);
  }
  if (e.k === "call") {
    const resolved = ctx.idx.lang.resolveCall?.(e, fn, ctx) ?? injectedCall(e, fn, ctx);
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
  const built = fluentMap(e, fn, ctx);
  if (built) return built.expr.k === "dict" ? { entries: built.expr.entries, fn: built.fn } : undefined;
  const d = deref(e, fn, ctx);
  const derefBuilt = d.expr !== e ? fluentMap(d.expr, d.fn, ctx) : undefined;
  if (derefBuilt) return derefBuilt.expr.k === "dict" ? { entries: derefBuilt.expr.entries, fn: derefBuilt.fn } : undefined;
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
