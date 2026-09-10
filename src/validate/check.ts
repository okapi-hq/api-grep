import { openapiSchemaToJsonSchema as toJsonSchema } from "@openapi-contrib/openapi-schema-to-json-schema";
import { Ajv } from "ajv";
import type { Finding, Shape } from "../types.js";

type JsonSchema = Record<string, unknown> & {
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

const MAX_DEPTH = 6;
const ajv = new Ajv({ allErrors: true, strict: false });

export function prepareSchema(openapiSchema: Record<string, unknown>): JsonSchema | undefined {
  try {
    const converted = toJsonSchema(openapiSchema as Parameters<typeof toJsonSchema>[0], { keepNotSupported: ["deprecated"] }) as JsonSchema;
    delete converted.$schema;
    if (!ajv.validateSchema(converted)) return undefined;
    return converted;
  } catch {
    return undefined;
  }
}

function typesOf(schema: JsonSchema): string[] {
  if (Array.isArray(schema.type)) return schema.type;
  if (schema.type) return [schema.type];
  if (schema.properties) return ["object"];
  return [];
}

function mergeAllOf(schema: JsonSchema): JsonSchema {
  if (!schema.allOf) return schema;
  const out: JsonSchema = { ...schema, properties: { ...(schema.properties ?? {}) }, required: [...(schema.required ?? [])] };
  for (const part of schema.allOf) {
    const p = mergeAllOf(part);
    Object.assign(out.properties!, p.properties ?? {});
    out.required!.push(...(p.required ?? []));
    if (p.type && !out.type) out.type = p.type;
  }
  delete out.allOf;
  return out;
}

function typeCompatible(shapeType: string, schemaTypes: string[]): boolean {
  if (schemaTypes.length === 0) return true;
  if (schemaTypes.includes(shapeType)) return true;
  if (shapeType === "integer" && schemaTypes.includes("number")) return true;
  if (shapeType === "null" && schemaTypes.includes("null")) return true;
  return false;
}

function checkPrimitive(shape: Shape, schema: JsonSchema, at: string, ref: string, out: Finding[]): void {
  const types = typesOf(schema);
  if (!typeCompatible(shape.type, types)) {
    out.push({ rule: "type-mismatch", severity: "high", property: at, message: `extracted ${shape.type}, spec expects ${types.join(" | ")}`, specRef: ref });
    return;
  }
  if ("enum" in shape && shape.enum && Array.isArray(schema.enum)) {
    for (const v of shape.enum) {
      if (!schema.enum.includes(v)) out.push({ rule: "enum-mismatch", severity: "high", property: at, message: `value ${JSON.stringify(v)} not in spec enum`, specRef: ref });
    }
  }
}

function checkObject(shape: Shape & { type: "object" }, schema: JsonSchema, at: string, ref: string, out: Finding[], depth: number): void {
  const props = schema.properties ?? {};
  const additional = schema.additionalProperties;
  const hasProps = Object.keys(props).length > 0;
  for (const [key, sub] of Object.entries(shape.properties)) {
    const ps = props[key];
    if (!ps) {
      if (additional === false) out.push({ rule: "unknown-property", severity: "high", property: `${at}${key}`, message: `property "${key}" is not in the spec`, specRef: ref });
      else if (hasProps && typeof additional !== "object") out.push({ rule: "unknown-property", severity: "low", property: `${at}${key}`, message: `property "${key}" is not in the spec (additional properties not forbidden)`, specRef: ref });
      continue;
    }
    if (ps.deprecated) out.push({ rule: "deprecated", severity: "low", property: `${at}${key}`, message: `property "${key}" is deprecated`, specRef: ref });
    compare(sub, ps, `${at}${key}.`, ref, out, depth + 1);
  }
  if (!shape.dynamicKeys) {
    for (const req of schema.required ?? []) {
      if (!(req in shape.properties)) out.push({ rule: "missing-required", severity: "medium", property: `${at}${req}`, message: `required property "${req}" is missing`, specRef: ref });
    }
  }
}

function compare(shape: Shape, rawSchema: JsonSchema, at: string, ref: string, out: Finding[], depth: number): void {
  if (depth > MAX_DEPTH || shape.type === "dynamic" || shape.type === "unknown") return;
  const schema = mergeAllOf(rawSchema);
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (alternatives && alternatives.length > 0) {
    const attempts = alternatives.map((alt) => {
      const findings: Finding[] = [];
      compare(shape, alt, at, ref, findings, depth + 1);
      return findings;
    });
    attempts.sort((a, b) => a.length - b.length);
    out.push(...attempts[0]!);
    return;
  }
  if (shape.type === "union") return;
  if (shape.type === "object") {
    if (!typeCompatible("object", typesOf(schema))) out.push({ rule: "type-mismatch", severity: "high", property: at || "body", message: `extracted object, spec expects ${typesOf(schema).join(" | ")}`, specRef: ref });
    else checkObject(shape, schema, at, ref, out, depth);
    return;
  }
  if (shape.type === "array") {
    if (!typeCompatible("array", typesOf(schema))) out.push({ rule: "type-mismatch", severity: "high", property: at || "body", message: `extracted array, spec expects ${typesOf(schema).join(" | ")}`, specRef: ref });
    else if (schema.items) compare(shape.items, schema.items, `${at}[].`, ref, out, depth + 1);
    return;
  }
  checkPrimitive(shape, schema, at.replace(/\.$/, "") || "body", ref, out);
}

/** Deterministic shape-vs-schema checks. Never inspects values beyond literal enums. */
export function checkShape(shape: Shape | undefined, openapiSchema: Record<string, unknown> | undefined, ref: string): Finding[] {
  if (!shape || !openapiSchema) return [];
  const schema = prepareSchema(openapiSchema);
  if (!schema) return [];
  const out: Finding[] = [];
  compare(shape, schema, "", ref, out, 0);
  return out;
}
