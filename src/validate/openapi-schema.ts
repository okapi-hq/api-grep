export type JsonSchema = Record<string, unknown> & {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: unknown[];
  deprecated?: boolean;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
};

/** Deeper than any shape the scan compares. */
const MAX_DEPTH = 16;
/** Schemas converted per request body at most: a spec of shared sub-schemas cannot make the conversion explode. */
const MAX_NODES = 5000;
const SUB_SCHEMA = ["items", "additionalProperties", "not"] as const;
const SUB_SCHEMAS = ["allOf", "anyOf", "oneOf"] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Where a conversion is: the schemas above the current one (a dereferenced spec turns a recursive `$ref` into an object
 * cycle, which is cut there) and how many schemas are left to convert.
 */
interface Walk {
  ancestors: Set<object>;
  budget: { left: number };
}

function convertProperties(props: Record<string, unknown>, walk: Walk): Record<string, JsonSchema> {
  const out: Record<string, JsonSchema> = {};
  for (const [key, value] of Object.entries(props)) {
    const converted = convert(value, walk);
    if (converted) out[key] = converted;
  }
  return out;
}

/** `nullable: true` (OpenAPI 3.0) is a `null` type in JSON Schema, and a `null` enum value when there is an enum. */
function convertNullable(out: JsonSchema): void {
  if (out.nullable === true && out.type !== undefined) {
    out.type = [...(Array.isArray(out.type) ? out.type : [out.type]), "null"];
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
  }
  delete out.nullable;
}

/** OpenAPI 3.0 writes exclusive bounds as booleans (draft-04); draft-07 wants the bound itself. */
function convertExclusiveBounds(out: JsonSchema): void {
  for (const [flag, bound] of [
    ["exclusiveMinimum", "minimum"],
    ["exclusiveMaximum", "maximum"],
  ] as const) {
    if (typeof out[flag] !== "boolean") continue;
    if (out[flag] && typeof out[bound] === "number") {
      out[flag] = out[bound];
      delete out[bound];
    } else delete out[flag];
  }
}

/**
 * OpenAPI 3.0 schema object -> JSON Schema (draft-07), as far as the shape checks read it: `nullable`, exclusive
 * bounds, and `required` limited to declared properties. Pure, since every call to an operation shares its schema.
 */
export function toJsonSchema(schema: unknown): JsonSchema | undefined {
  return convert(schema, { ancestors: new Set(), budget: { left: MAX_NODES } });
}

function convert(schema: unknown, walk: Walk): JsonSchema | undefined {
  if (!isObject(schema)) return undefined;
  // a cycle, or too deep / too large to matter: an empty schema accepts anything, so it reports nothing
  if (walk.ancestors.has(schema) || walk.ancestors.size > MAX_DEPTH || walk.budget.left-- <= 0) return {};
  walk.ancestors.add(schema);
  const out = convertNode(schema, walk);
  walk.ancestors.delete(schema);
  return out;
}

function convertNode(schema: Record<string, unknown>, walk: Walk): JsonSchema {
  const out: JsonSchema = { ...schema };
  for (const key of SUB_SCHEMA) if (isObject(schema[key])) out[key] = convert(schema[key], walk);
  for (const key of SUB_SCHEMAS) {
    const list = schema[key];
    if (Array.isArray(list)) out[key] = list.map((s) => convert(s, walk)).filter((s): s is JsonSchema => !!s);
  }
  if (isObject(schema.properties)) {
    const properties = convertProperties(schema.properties, walk);
    out.properties = properties;
    if (Array.isArray(schema.required)) out.required = schema.required.filter((k): k is string => typeof k === "string" && Object.hasOwn(properties, k));
  }
  convertNullable(out);
  convertExclusiveBounds(out);
  return out;
}
