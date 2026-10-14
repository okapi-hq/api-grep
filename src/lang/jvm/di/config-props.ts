import { typeChain, valueChain } from "../../ir/chain.js";
import type { Scoped } from "../../ir/language.js";
import { dottedPath, type Annotation, type CallExpr, type ClassDef, type Entry, type Expr, type FunctionDef } from "../../ir/model.js";
import { classField } from "../../ir/project.js";
import type { IrCtx } from "../../ir/raw.js";
import { deref, entryOf } from "../../ir/values.js";
import { annotationName } from "../annotations.js";
import { springProperty } from "../spring-config.js";

/**
 * Spring `@ConfigurationProperties(prefix = "weather")` classes (#94): an injected one is the configuration it binds,
 * each property the configuration value `weather.base-url` (the canonical, kebab-case name) with the default the
 * module's `application.yml` / `.properties` gives it, else the class's (a constructor default, a field initializer, a
 * record's `@DefaultValue`), as `@Value("${x:default}")` reads (#100). A property typed with a class of the project is
 * a nested group (`weather.api.base-url`); a `@Bean` method annotated `@ConfigurationProperties` binds the class it
 * returns.
 */

/** Types a property is a value of; a collection is not one value. */
const SCALARS = new Set(["String", "CharSequence", "Int", "Integer", "Long", "Short", "Boolean", "Double", "Float", "URI", "URL", "Uri", "Duration", "HttpUrl"]);
/** Nested groups read this deep at most. */
const MAX_NESTING = 3;

const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const literal = (e: Expr | undefined): string | undefined => (e?.k === "str" ? e.v : undefined);

/** The prefix an `@ConfigurationProperties` annotation gives: `prefix`, `value` or its one argument. */
function prefixOf(anns: Annotation[] | undefined): string | undefined {
  const a = anns?.find((x) => annotationName(x) === "ConfigurationProperties");
  if (!a) return undefined;
  const arg = a.args.find((x) => x.name === "prefix" || x.name === "value") ?? a.args.find((x) => !x.name);
  const text = literal(arg?.value);
  return text !== undefined && /^[a-z0-9.-]*$/i.test(text) ? text : undefined;
}

/** The prefix of a class annotated `@ConfigurationProperties`. */
export const propertiesPrefix = (cls: ClassDef): string | undefined => prefixOf(cls.classAnnotations);

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

/** The project class a property's type names (`val api: Api`, `private Api api`): a nested group. */
function groupClass(type: Expr | undefined, cls: ClassDef, ctx: IrCtx): ClassDef | undefined {
  if (!type || scalar(type)) return undefined;
  const c = typeChain(type, cls.methods.get("<init>") ?? cls.module.top, ctx);
  if (c.root.kind === "instance" && c.segs.length === 0) return c.root.cls !== cls ? c.root.cls : undefined;
  // a class nested in the properties class (`data class Api(...)` inside it), named bare
  const path = dottedPath(type);
  const hit = path ? ctx.idx.resolvePath([...cls.qname.split("."), ...path]) : undefined;
  return hit?.member.kind === "class" && hit.rest.length === 0 ? hit.member.cls : undefined;
}

/** A property: the configuration file's value, else the class's default, as the read of its name. */
function property(cls: ClassDef, name: string, key: string, ctx: IrCtx): Expr {
  const configured = ctx.rootDir ? springProperty(cls.module.file, ctx.rootDir, key) : undefined;
  if (configured) return configured;
  const dflt = defaultOf(cls, name, ctx);
  return { k: "env", name: key, ...(dflt ? { fallback: { k: "scoped", expr: dflt.expr, fn: dflt.fn } as Expr } : {}) };
}

function entries(cls: ClassDef, prefix: string, ctx: IrCtx, depth = 0): Entry[] {
  const out: Entry[] = [];
  for (const [name, type] of cls.fieldTypes) {
    // a constant of the class (`static final`, a companion `const val`) is not a property
    if (classField(cls, name, ctx.idx).some((f) => f.fn.name === "<clinit>")) continue;
    const key = prefix ? `${prefix}.${kebab(name)}` : kebab(name);
    const group = depth < MAX_NESTING ? groupClass(type, cls, ctx) : undefined;
    if (group) out.push({ key: { k: "str", v: name }, value: { k: "dict", entries: entries(group, key, ctx, depth + 1) } });
    else if (scalar(type)) out.push({ key: { k: "str", v: name }, value: property(cls, name, key, ctx) });
  }
  return out;
}

const beanBindings = new WeakMap<object, FunctionDef[]>();

/** `@Bean @ConfigurationProperties("x") fun apiProps() = ApiProps()`: the bean methods binding what they return. */
function bindingMethods(ctx: IrCtx): FunctionDef[] {
  const mods = ctx.idx.all();
  let out = beanBindings.get(mods);
  if (!out) {
    out = mods.flatMap((m) => m.allFunctions.filter((f) => prefixOf(f.annotations) !== undefined && f.annotations?.some((a) => annotationName(a) === "Bean")));
    beanBindings.set(mods, out);
  }
  return out;
}

/** The class a bean method returns: its declared return type, else the class its one return constructs. */
function returnedClass(fn: FunctionDef, ctx: IrCtx): ClassDef | undefined {
  const c = fn.returnType ? typeChain(fn.returnType, fn, ctx) : fn.returns.length === 1 ? valueChain(fn.returns[0]!, fn, ctx) : undefined;
  return c?.root.kind === "instance" && c.segs.length === 0 ? c.root.cls : undefined;
}

/** The prefix a class is bound with: its own annotation, else the one `@Bean` method binding it (two: none). */
function bindingPrefix(cls: ClassDef, ctx: IrCtx): string | undefined {
  const own = propertiesPrefix(cls);
  if (own !== undefined) return own;
  const methods = bindingMethods(ctx).filter((f) => returnedClass(f, ctx) === cls);
  return methods.length === 1 ? prefixOf(methods[0]!.annotations) : undefined;
}

/** An injection point typed with a `@ConfigurationProperties` class: its properties, as an object of configuration reads. */
export function configurationProperties(type: Expr | undefined, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  const c = type ? typeChain(type, fn, ctx) : undefined;
  const cls = c?.root.kind === "instance" && c.segs.length === 0 ? c.root.cls : undefined;
  const prefix = cls ? bindingPrefix(cls, ctx) : undefined;
  if (!cls || prefix === undefined) return undefined;
  return { expr: { k: "dict", entries: entries(cls, prefix, ctx) }, fn: cls.methods.get("<init>") ?? cls.module.top };
}

const ACCESSOR = /^(?:get|is)([A-Z]\w*)$/;

/** Configuration properties as a dict: every value a read of the configuration or a nested group. */
const bound = (entries: Entry[]): boolean => entries.every((e) => e.value.k === "env" || e.value.k === "tmpl" || (e.value.k === "dict" && bound(e.value.entries)));

/** `props.getBaseUrl()`, `props.getApi().getBaseUrl()`, a record's `props.baseUrl()` on configuration properties: the property's value. */
export function configurationGetter(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (call.fn.k !== "attr" || call.args.length > 0 || call.fn.obj.k === "this") return undefined;
  const d = deref(call.fn.obj, fn, ctx);
  if (d.expr.k !== "dict" || !bound(d.expr.entries)) return undefined;
  const m = ACCESSOR.exec(call.fn.name);
  const name = m ? m[1]!.charAt(0).toLowerCase() + m[1]!.slice(1) : call.fn.name;
  return entryOf({ entries: d.expr.entries, fn: d.fn }, name, ctx);
}
