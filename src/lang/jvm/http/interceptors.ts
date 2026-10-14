import { calleeChain } from "../../ir/chain.js";
import type { Scoped } from "../../ir/language.js";
import type { CallExpr, ClassDef, FunctionDef } from "../../ir/model.js";
import { classMethod, lookup } from "../../ir/project.js";
import { withSelf, withSubst, type IrCtx, type Subst } from "../../ir/raw.js";
import { calleeIs, lambdaOf } from "../../ir/steps.js";
import { deref } from "../../ir/values.js";
import { substitutionFor } from "../../ir/wrappers.js";
import { elementsOf, withClosures } from "../elements.js";

/** An interceptor's code, and what its values read: the constructor arguments and class of an interceptor object. */
export interface Interceptor {
  fn: FunctionDef;
  subst?: Subst;
  self?: ClassDef;
  /** The context it was reached in: the substitutions of the wrappers and helpers it went through. */
  ctx: IrCtx;
}

/** Interceptors wrapping interceptors, followed this deep at most. */
const MAX_DEPTH = 4;

/** A project class with no method of its own but its SAM (`fun interface AppInterceptor : StationInterceptor`). */
const funInterface = (cls: ClassDef): boolean => cls.methods.size === 0 || (cls.methods.size === 1 && cls.methods.has("<init>"));

/** `x.toAppInterceptor()`, a project extension returning a wrapper: its one return, its receiver the call's object. */
function extensionResult(call: CallExpr, fn: FunctionDef, ctx: IrCtx): { value: Scoped; ctx: IrCtx } | undefined {
  if (call.fn.k !== "attr") return undefined;
  const exts = (ctx.idx.extensions.get(call.fn.name) ?? []).filter((e) => e.returns.length === 1);
  const ext = exts.length === 1 ? exts[0]! : undefined;
  return ext ? { value: { expr: ext.returns[0]!, fn: ext }, ctx: withSubst(ctx, substitutionFor(ext, call, fn)) } : undefined;
}

/** `{ chain -> ... }`, `Interceptor { ... }`, a project `fun interface`'s lambda, `object : Interceptor { ... }`, `AuthInterceptor(token)`. */
function ownInterceptor(d: Scoped, ctx: IrCtx): Interceptor | undefined {
  if (d.expr.k === "fnref") return { fn: d.expr.fn, ctx };
  if (d.expr.k !== "call") return undefined;
  const lambda = lambdaOf(d.expr);
  const target = calleeChain(d.expr, d.fn, ctx);
  const cls = target.root.kind === "class" && target.segs.length === 0 ? target.root.cls : undefined;
  if (lambda && (calleeIs(d.expr, ["Interceptor"]) || (cls && funInterface(cls) && d.expr.args.length === 1))) return { fn: lambda, ctx };
  if (!cls) return undefined;
  const intercept = classMethod(cls, "intercept", ctx.idx);
  const init = classMethod(cls, "<init>", ctx.idx);
  return intercept ? { fn: intercept, self: cls, ctx, ...(init ? { subst: substitutionFor(init, d.expr, d.fn) } : {}) } : undefined;
}

/** The function with a receiver a lambda is written in (`fun Interceptor.toAppInterceptor() = AppInterceptor { ... }`). */
function receiverOf(fn: FunctionDef): FunctionDef | undefined {
  for (let f: FunctionDef | undefined = fn; f; f = f.parent) if (f.receiver) return f;
  return undefined;
}

/**
 * What an interceptor hands the request to (#100): `other.intercept(chain)`, or a bare `intercept(chain)` on the
 * receiver of the extension it is written in. The wrapped interceptor's headers are the wrapper's.
 */
function delegates(i: Interceptor): Scoped[] {
  const out: Scoped[] = [];
  for (const f of withClosures(i.fn)) {
    for (const c of f.calls) {
      if ((c.fn.k !== "attr" && c.fn.k !== "name") || c.fn.name !== "intercept" || c.args.length !== 1) continue;
      if (c.fn.k === "attr") out.push({ expr: c.fn.obj, fn: f });
      // a SAM lambda is a receiver lambda to the grammar: a bare `intercept` the project does not declare is the receiver's
      const bare = c.fn.k === "name" && (c.fn.implicit || lookup("intercept", f, c.pos.offset, i.ctx.idx).kind === "none");
      const ext = bare ? receiverOf(f) : undefined;
      if (ext?.receiver) out.push({ expr: { k: "name", name: ext.receiver.name, pos: c.pos }, fn: ext });
    }
  }
  return out;
}

/**
 * The interceptors a value stands for: its own code, and those it wraps (`Interceptor { wrapped.intercept(it) }`,
 * `x.toAppInterceptor()`), each with the context it was reached in.
 */
export function interceptorsOf(arg: Scoped, ctx: IrCtx, depth = 0): Interceptor[] {
  if (depth > MAX_DEPTH) return [];
  const d = deref(arg.expr, arg.fn, ctx);
  const own = ownInterceptor(d, ctx);
  if (!own) {
    const wrapper = d.expr.k === "call" ? extensionResult(d.expr, d.fn, ctx) : undefined;
    return wrapper ? interceptorsOf(wrapper.value, wrapper.ctx, depth + 1) : [];
  }
  // `inner.intercept(chain)` in a class reads its field with the arguments the object was made with
  const inner = withSelf(withSubst(own.ctx, own.subst), own.self);
  const wrapped = delegates(own).flatMap((w) => elementsOf(w, inner).flatMap((e) => interceptorsOf(e, inner, depth + 1)));
  return [own, ...wrapped];
}

