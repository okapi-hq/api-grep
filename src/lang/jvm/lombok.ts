import { builderValue } from "../ir/builders.js";
import { constructedValue } from "../ir/constructed.js";
import { valueChain } from "../ir/chain.js";
import type { Scoped, SetterRules } from "../ir/language.js";
import type { CallExpr, ClassDef, Expr, FunctionDef } from "../ir/model.js";
import { classField, classMethod, projectBases } from "../ir/project.js";
import type { IrCtx } from "../ir/raw.js";
import { annotationName } from "./annotations.js";
import { configurationGetter } from "./di/config-props.js";
import { httpBuilt } from "./http/bodies.js";

/**
 * Lombok writes code at build time that the scan never sees: `@Builder` classes get `X.builder().a(1).build()`, and
 * `@Data` / `@Getter` / `@Value` classes get `getA()`. Read from the class's annotations, a built value is the dict of
 * the fields it sets and a getter reads the field.
 */

const BUILDERS = new Set(["Builder", "SuperBuilder"]);
const GETTERS = new Set(["Data", "Getter", "Value"]);
const GETTER = /^(?:get|is)([A-Z]\w*)$/;

const annotated = (cls: ClassDef, names: Set<string>): boolean => (cls.classAnnotations ?? []).some((a) => names.has(annotationName(a) ?? ""));

/** The class itself and its project bases (a `@SuperBuilder` sets the fields of both). */
function lineage(cls: ClassDef, ctx: IrCtx, seen = new Set<ClassDef>()): ClassDef[] {
  if (seen.has(cls) || seen.size > 8) return [];
  seen.add(cls);
  return [cls, ...projectBases(cls, ctx.idx).flatMap((b) => lineage(b, ctx, seen))];
}

/** The project class an expression names (`Payload` in `Payload.builder()`). */
function projectClass(e: Expr, fn: FunctionDef, ctx: IrCtx): ClassDef | undefined {
  const c = valueChain(e, fn, ctx);
  return c.root.kind === "class" && c.segs.length === 0 ? c.root.cls : undefined;
}

/**
 * A Lombok `@Builder` class without a `builder()` of its own: each builder method is named after a field, which the
 * body holds under its JSON name (`@JsonProperty("user_id") userId` set by `.userId(id)`).
 */
function lombokRules(e: Expr, fn: FunctionDef, ctx: IrCtx): SetterRules | undefined {
  const cls = projectClass(e, fn, ctx);
  if (!cls || !annotated(cls, BUILDERS) || classMethod(cls, "builder", ctx.idx)) return undefined;
  const fields: Record<string, string> = {};
  const items: Record<string, string> = {};
  for (const c of lineage(cls, ctx)) {
    // a JSON name with `:` would read as a role (`SetterRules.fields`): such a field keeps its own name
    for (const a of c.annotations) if (a.field && !a.name.includes(":")) fields[a.field] = a.name;
    for (const [field, singular] of singulars(c)) items[singular] = c.annotations.find((a) => a.field === field && !a.name.includes(":"))?.name ?? field;
  }
  return { packages: [], case: "camel", fields, items };
}

/** The adder of a `@Singular` field: as the annotation names it, else the field's name in the singular (`tags` -> `tag`). */
function singulars(cls: ClassDef): [string, string][] {
  const out: [string, string][] = [];
  for (const [field, annotations] of cls.fieldAnnotations ?? []) {
    const a = annotations.find((x) => annotationName(x) === "Singular");
    if (!a) continue;
    const given = a.args.find((x) => !x.name || x.name === "value")?.value;
    const singular = given?.k === "str" ? given.v : field.replace(/ies$/, "y").replace(/(ch|sh|x|ss)es$/, "$1").replace(/([^s])s$/, "$1");
    if (singular && singular !== field) out.push([field, singular]);
  }
  return out;
}

/** `config.getBaseUrl()` on a project class whose getters Lombok writes: the field `config.baseUrl`. */
function lombokGetter(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  const m = call.fn.k === "attr" && call.args.length === 0 ? GETTER.exec(call.fn.name) : null;
  if (!m || call.fn.k !== "attr") return undefined;
  const obj = call.fn.obj;
  const c = valueChain(obj, fn, ctx);
  const cls = c.root.kind === "instance" && c.segs.length === 0 ? c.root.cls : undefined;
  if (!cls || classMethod(cls, call.fn.name, ctx.idx)) return undefined;
  const field = m[1]!.charAt(0).toLowerCase() + m[1]!.slice(1);
  const owner = lineage(cls, ctx).find((k) => k.fieldTypes.has(field));
  if (!owner || !(annotated(owner, GETTERS) || annotated(cls, GETTERS))) return undefined;
  // a field nothing in the project sets (filled by a framework) says no more than the getter's name
  if (classField(cls, field, ctx.idx).length === 0) return undefined;
  return { expr: { k: "attr", obj, name: field, pos: call.fn.pos }, fn };
}

/** The JVM's `resolveCall`: an SDK or Lombok builder's fields, a Lombok getter's field, a body built by a library helper. */
export function jvmResolveCall(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  return builderValue(call, fn, ctx, lombokRules) ?? constructedValue(call, fn, ctx) ?? configurationGetter(call, fn, ctx) ?? lombokGetter(call, fn, ctx) ?? httpBuilt(call, fn);
}
