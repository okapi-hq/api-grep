import type { Scoped } from "./language.js";
import type { CallExpr, ClassDef, FunctionDef, Param } from "./model.js";
import type { IrCtx } from "./raw.js";

/** A parameter's value: the argument a wrapper expansion substituted, else what a DI container injects (`injection`). */
export const paramValue = (p: Param, fn: FunctionDef, ctx: IrCtx): Scoped | undefined => ctx.subst?.get(p) ?? ctx.idx.lang.injection?.param(p, fn, ctx);

/** A field nothing assigns, injected by its annotation (`@Autowired`, `@Inject lateinit var`). */
export const injectedField = (cls: ClassDef | undefined, name: string, ctx: IrCtx): Scoped | undefined => (cls ? ctx.idx.lang.injection?.field(cls, name, ctx) : undefined);

/** A container lookup (`get<HttpClient>()`): the value it is given. */
export const injectedCall = (call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined => ctx.idx.lang.injection?.call(call, fn, ctx);
