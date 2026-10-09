import { calleeChain } from "./chain.js";
import type { Scoped } from "./language.js";
import { argFor, type CallExpr, type ClassDef, type Expr, type FunctionDef } from "./model.js";
import { classField, classMethod, projectBases } from "./project.js";
import { withSubst, type IrCtx, type Subst } from "./raw.js";
import { deref } from "./values.js";

const MAX_DEPTH = 4;

/** A field's value and the context it reads in: the constructor's parameters bound to the call's arguments. */
export interface FieldValue extends Scoped {
  ctx: IrCtx;
}

/** The constructor order of a class without one of its own (dataclass, NamedTuple, attrs): base class fields first. */
function recordFields(cls: ClassDef, ctx: IrCtx, seen = new Set<ClassDef>()): string[] {
  if (seen.has(cls)) return [];
  seen.add(cls);
  const names = [...projectBases(cls, ctx.idx).flatMap((b) => recordFields(b, ctx, seen)), ...cls.annotations.map((a) => a.name)];
  return names.filter((n, i) => names.indexOf(n) === i);
}

/**
 * Field `name` of the object `Cls(...)` / `new Cls(...)` builds: what the constructor stores there (`self.base = base`,
 * a promoted `$base`), read with its parameters bound to the call's arguments; for a class without a constructor of its
 * own, the argument for that field (by keyword, else by position), else its declared default.
 */
function constructed(call: CallExpr, caller: FunctionDef, name: string, ctx: IrCtx): FieldValue | undefined {
  const target = calleeChain(call, caller, ctx);
  if (target.root.kind !== "class" || target.segs.length > 0) return undefined;
  const cls = target.root.cls;
  const init = classMethod(cls, "__init__", ctx.idx) ?? classMethod(cls, "__construct", ctx.idx);
  if (init) {
    const stored = classField(cls, name, ctx.idx).find((f) => f.fn === init);
    if (!stored) return undefined;
    const subst: Subst = new Map();
    for (const p of init.params) {
      const arg = p.kind === "normal" ? argFor(call, p) : undefined;
      if (arg) subst.set(p, { expr: arg.value, fn: caller });
      else if (p.default) subst.set(p, { expr: p.default, fn: init });
    }
    return { expr: stored.value, fn: init, ctx: withSubst(ctx, subst) };
  }
  const i = recordFields(cls, ctx).indexOf(name);
  if (i < 0) return undefined;
  const arg = call.args.find((a) => a.name === name) ?? call.args.filter((a) => !a.name && !a.spread)[i];
  if (arg) return { expr: arg.value, fn: caller, ctx };
  const dflt = classField(cls, name, ctx.idx)[0];
  return dflt ? { expr: dflt.value, fn: dflt.fn, ctx } : undefined;
}

/** `replace(call, headers=...)` (dataclasses, copy) / `call._replace(...)` (NamedTuple): the changed field, else the copied one. */
function replaced(call: CallExpr, caller: FunctionDef, name: string, ctx: IrCtx, depth: number): FieldValue | undefined {
  const fnName = call.fn.k === "name" || call.fn.k === "attr" ? call.fn.name : undefined;
  if (fnName !== "replace" && fnName !== "_replace") return undefined;
  const changed = call.args.find((a) => a.name === name);
  if (changed) return { expr: changed.value, fn: caller, ctx };
  const original = fnName === "_replace" && call.fn.k === "attr" ? call.fn.obj : call.args.find((a) => !a.name && !a.spread)?.value;
  return original ? instanceField(original, name, caller, ctx, depth + 1) : undefined;
}

/** `call.base` where `call` holds an object built in the project: `Call(base="https://...")`, `new Call(base: '...')`. */
export function instanceField(obj: Expr, name: string, fn: FunctionDef, ctx: IrCtx, depth = 0): FieldValue | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const made = deref(obj, fn, ctx);
  if (made.expr.k !== "call") return undefined;
  return replaced(made.expr, made.fn, name, ctx, depth) ?? constructed(made.expr, made.fn, name, ctx);
}
