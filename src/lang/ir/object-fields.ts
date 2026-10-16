import { typeChain, valueChain } from "./chain.js";
import { instanceField } from "./instance.js";
import type { Scoped } from "./language.js";
import type { ClassDef, Expr, FunctionDef } from "./model.js";
import { classField, lookup } from "./project.js";
import type { IrCtx } from "./raw.js";

/**
 * `settings.model`, `get_settings().model`, `Configuration.from_runnable_config(c).model`: a field of an object of a
 * record class of the project (dataclass, pydantic model, settings class), the value it gets and, for a settings class,
 * the env var it is read from (`IrLanguage.fieldEnv`).
 */

export interface RecordField {
  cls: ClassDef;
  /** The value the field gets: the constructor's argument for it, else the class's default, and the context it reads in. */
  value?: Scoped & { ctx?: IrCtx };
  /** `value` is the class's default, not an argument given. */
  isDefault: boolean;
  /** The env var a settings class reads the field from, unless the constructor gives it. */
  env?: string;
}

const builtByReceiver = (e: Expr, fn: FunctionDef): boolean => e.k === "call" && e.fn.k === "this" && !!fn.cls;

/** The project class of the object an expression stands for (`Settings()`, a factory's return, `cls(...)`, a typed parameter). */
export function objectClass(e: Expr, fn: FunctionDef, ctx: IrCtx): ClassDef | undefined {
  // `return cls(**values)` in a classmethod (`cls` lowers as the receiver) builds the class it is called on
  if (builtByReceiver(e, fn)) return fn.cls;
  if (e.k === "name") {
    const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
    if (b.kind === "param" && b.param.type) {
      const typed = typeChain(b.param.type, b.fn, ctx);
      if (typed.root.kind === "instance" && typed.segs.length === 0) return typed.root.cls;
    }
    if (b.kind === "value" && b.assign.value.k === "call") {
      const made = objectClass(b.assign.value, b.fn, ctx);
      if (made) return made;
    }
  }
  const c = valueChain(e, fn, ctx);
  if (c.root.kind === "instance" && c.segs.length === 0) return c.root.cls;
  // a factory that returns `cls(...)`: one return, read as the class it builds
  if (e.k === "call") {
    const callee = valueChain(e.fn, fn, ctx);
    const target = callee.root.kind === "function" && callee.segs.length === 0 ? callee.root.fn : undefined;
    const only = target?.returns.length === 1 ? target.returns[0]! : undefined;
    if (only && builtByReceiver(only, target!)) return target!.cls;
  }
  return undefined;
}

const isRecord = (cls: ClassDef): boolean => cls.annotations.length > 0;

/** A field of a record object; undefined when the object is none, or the class neither has the field nor reads it from the env. */
export function recordField(e: Expr & { k: "attr" }, fn: FunctionDef, ctx: IrCtx): RecordField | undefined {
  if (e.obj.k === "this") return undefined;
  const cls = objectClass(e.obj, fn, ctx);
  if (!cls || !isRecord(cls)) return undefined;
  // a field declared in the class body (methods' `self.x = ...` are not defaults)
  const declared = classField(cls, e.name, ctx.idx).find((f) => !f.fn.cls);
  const given = instanceField(e.obj, e.name, fn, ctx);
  const isDefault = !given || (!!declared && given.expr === declared.value);
  const env = isDefault ? ctx.idx.lang.fieldEnv?.(cls, e.name, ctx) : undefined;
  const value = given ?? (declared ? { expr: declared.value, fn: declared.fn } : undefined);
  if (!value && !env) return undefined;
  return { cls, ...(value ? { value } : {}), isDefault, ...(env ? { env } : {}) };
}
