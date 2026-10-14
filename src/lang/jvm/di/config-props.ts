import { typeChain } from "../../ir/chain.js";
import type { Scoped } from "../../ir/language.js";
import { dottedPath, type CallExpr, type ClassDef, type Entry, type Expr, type FunctionDef } from "../../ir/model.js";
import { classField } from "../../ir/project.js";
import type { IrCtx } from "../../ir/raw.js";
import { deref, entryOf } from "../../ir/values.js";
import { annotationName } from "../annotations.js";

/**
 * Spring `@ConfigurationProperties(prefix = "weather")` classes (#94): an injected one is the configuration it binds,
 * each property the configuration value `weather.base-url` (the canonical, kebab-case name) with the default the class
 * gives it (a constructor default, a field initializer, a record's `@DefaultValue`), as `@Value("${x:default}")` reads.
 */

/** Types a property is a value of; a nested class or a collection is not one value. */
const SCALARS = new Set(["String", "CharSequence", "Int", "Integer", "Long", "Short", "Boolean", "Double", "Float", "URI", "URL", "Uri", "Duration", "HttpUrl"]);

const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const literal = (e: Expr | undefined): string | undefined => (e?.k === "str" ? e.v : undefined);

/** The prefix of a class annotated `@ConfigurationProperties`: `prefix`, `value` or its one argument. */
export function propertiesPrefix(cls: ClassDef): string | undefined {
  const a = cls.classAnnotations?.find((x) => annotationName(x) === "ConfigurationProperties");
  if (!a) return undefined;
  const arg = a.args.find((x) => x.name === "prefix" || x.name === "value") ?? a.args.find((x) => !x.name);
  const text = literal(arg?.value);
  return text !== undefined && /^[a-z0-9.-]*$/i.test(text) ? text : undefined;
}

function scalar(type: Expr | undefined): boolean {
  const path = type ? dottedPath(type) : undefined;
  return !!path && SCALARS.has(path[path.length - 1]!);
}

/** The default the class gives a property: its constructor parameter's default (or `@DefaultValue`), else its initializer. */
function defaultOf(cls: ClassDef, name: string, ctx: IrCtx): Scoped | undefined {
  const init = cls.methods.get("<init>");
  const set = classField(cls, name, ctx.idx).find((f) => f.fn === init);
  if (!init || !set) return undefined;
  const param = set.value.k === "name" ? init.params.find((p) => p.name === (set.value as { name: string }).name) : undefined;
  if (!param) return { expr: set.value, fn: init };
  const given = param.annotations?.find((a) => annotationName(a) === "DefaultValue")?.args[0]?.value;
  const value = given ?? param.default;
  return value ? { expr: value, fn: init } : undefined;
}

function entries(cls: ClassDef, prefix: string, ctx: IrCtx): Entry[] {
  const out: Entry[] = [];
  for (const [name, type] of cls.fieldTypes) {
    // a constant of the class (`static final`, a companion `const val`) is not a property
    if (!scalar(type) || classField(cls, name, ctx.idx).some((f) => f.fn.name === "<clinit>")) continue;
    const dflt = defaultOf(cls, name, ctx);
    const fallback: Expr | undefined = dflt ? { k: "scoped", expr: dflt.expr, fn: dflt.fn } : undefined;
    out.push({ key: { k: "str", v: name }, value: { k: "env", name: prefix ? `${prefix}.${kebab(name)}` : kebab(name), ...(fallback ? { fallback } : {}) } });
  }
  return out;
}

/** An injection point typed with a `@ConfigurationProperties` class: its properties, as an object of configuration reads. */
export function configurationProperties(type: Expr | undefined, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  const c = type ? typeChain(type, fn, ctx) : undefined;
  const cls = c?.root.kind === "instance" && c.segs.length === 0 ? c.root.cls : undefined;
  const prefix = cls ? propertiesPrefix(cls) : undefined;
  if (!cls || prefix === undefined) return undefined;
  return { expr: { k: "dict", entries: entries(cls, prefix, ctx) }, fn: cls.methods.get("<init>") ?? cls.module.top };
}

const ACCESSOR = /^(?:get|is)([A-Z]\w*)$/;

/** `props.getBaseUrl()`, a record's `props.baseUrl()` on configuration properties: the property's value. */
export function configurationGetter(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (call.fn.k !== "attr" || call.args.length > 0 || call.fn.obj.k === "this") return undefined;
  const d = deref(call.fn.obj, fn, ctx);
  if (d.expr.k !== "dict" || !d.expr.entries.every((e) => e.value.k === "env")) return undefined;
  const m = ACCESSOR.exec(call.fn.name);
  const name = m ? m[1]!.charAt(0).toLowerCase() + m[1]!.slice(1) : call.fn.name;
  return entryOf({ entries: d.expr.entries, fn: d.fn }, name, ctx);
}
