import type { ClassDef, Expr } from "../ir/model.js";
import { classField, lookup, projectBases } from "../ir/project.js";
import type { IrCtx } from "../ir/raw.js";
import { dictOf, entryOf, staticKey } from "../ir/values.js";

/**
 * pydantic-settings: a `BaseSettings` subclass reads each annotated field from the env var of its name, after the
 * `env_prefix` its configuration gives (`model_config = SettingsConfigDict(env_prefix="APP_")`, or pydantic v1's inner
 * `class Config`), case-insensitively unless `case_sensitive=True`; `Field(alias="X")` / `validation_alias="X"` /
 * `env="X"` names the variable itself.
 */

const SETTINGS_BASES = new Set(["pydantic_settings.BaseSettings", "pydantic_settings.main.BaseSettings", "pydantic.BaseSettings", "pydantic.env_settings.BaseSettings", "pydantic.v1.BaseSettings"]);
const MAX_BASES = 8;

/** The library classes a class extends, as dotted paths, through its project bases. */
function libraryBases(cls: ClassDef, ctx: IrCtx, seen = new Set<ClassDef>()): string[] {
  if (seen.has(cls) || seen.size > MAX_BASES) return [];
  seen.add(cls);
  const own = cls.bases.flatMap((b) => {
    const path = b.k === "name" ? lookupPath(b.name, cls, ctx) : b.k === "attr" && b.obj.k === "name" ? lookupPath(b.obj.name, cls, ctx)?.concat(b.name) : undefined;
    return path ? [path.join(".")] : [];
  });
  return [...own, ...projectBases(cls, ctx.idx).flatMap((b) => libraryBases(b, ctx, seen))];
}

function lookupPath(name: string, cls: ClassDef, ctx: IrCtx): string[] | undefined {
  const b = lookup(name, cls.module.top, undefined, ctx.idx);
  return b.kind === "external" ? b.path : undefined;
}

/** A configuration value written as a literal: `model_config`'s entry, else the v1 `Config` class's attribute. */
function configValue(cls: ClassDef, key: string, ctx: IrCtx, seen = new Set<ClassDef>()): Expr | undefined {
  if (seen.has(cls) || seen.size > MAX_BASES) return undefined;
  seen.add(cls);
  const config = classField(cls, "model_config", ctx.idx).find((f) => !f.fn.cls);
  const asCall = config?.value.k === "call" ? config.value : undefined;
  const fromCall = asCall?.args.find((a) => a.name === key)?.value;
  const dict = config && !asCall ? dictOf(config.value, config.fn, ctx) : undefined;
  const fromDict = dict ? entryOf(dict, key, ctx)?.expr : undefined;
  const inner = cls.module.classes.get(`${cls.qname.slice(cls.module.name ? cls.module.name.length + 1 : 0)}.Config`);
  const fromV1 = inner ? classField(inner, key, ctx.idx)[0]?.value : undefined;
  return fromCall ?? fromDict ?? fromV1 ?? projectBases(cls, ctx.idx).map((b) => configValue(b, key, ctx, seen)).find((v) => v !== undefined);
}

function textOf(e: Expr | undefined, cls: ClassDef, ctx: IrCtx): string | undefined {
  return e ? staticKey(e, cls.module.top, ctx) : undefined;
}

function annotated(cls: ClassDef, name: string, ctx: IrCtx, seen = new Set<ClassDef>()): ClassDef | undefined {
  if (seen.has(cls) || seen.size > MAX_BASES) return undefined;
  seen.add(cls);
  if (cls.annotations.some((a) => a.name === name)) return cls;
  return projectBases(cls, ctx.idx).map((b) => annotated(b, name, ctx, seen)).find((c) => !!c);
}

/** The env var a settings class reads its field `name` from; undefined for any other class or field. */
export function settingsFieldEnv(cls: ClassDef, name: string, ctx: IrCtx): string | undefined {
  const owner = annotated(cls, name, ctx);
  if (!owner || !libraryBases(cls, ctx).some((b) => SETTINGS_BASES.has(b))) return undefined;
  const alias = owner.fieldAliases?.get(name);
  if (alias) return alias;
  const prefix = textOf(configValue(cls, "env_prefix", ctx), cls, ctx) ?? "";
  const sensitive = configValue(cls, "case_sensitive", ctx);
  const env = `${prefix}${name}`;
  return sensitive?.k === "bool" && sensitive.v ? env : env.toUpperCase();
}
