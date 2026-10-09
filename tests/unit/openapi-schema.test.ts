import { describe, expect, it } from "vitest";
import { checkShape } from "../../src/validate/check.js";
import { toJsonSchema } from "../../src/validate/openapi-schema.js";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const nullableString = { type: "string", nullable: true };
const nullType = { type: ["string", "null"] };

describe("toJsonSchema nullable", () => {
  it("turns nullable into a null type and a null enum value", () => {
    expect(toJsonSchema(nullableString)).toEqual(nullType);
    expect(toJsonSchema({ type: "string", enum: ["a", "b"], nullable: true })).toEqual({ type: ["string", "null"], enum: ["a", "b", null] });
    expect(toJsonSchema({ type: "string", enum: ["a", null], nullable: true })).toEqual({ type: ["string", "null"], enum: ["a", null] });
    expect(toJsonSchema({ type: ["string", "number"], nullable: true })).toEqual({ type: ["string", "number", "null"] });
  });

  it("drops nullable when it is false or there is no type", () => {
    expect(toJsonSchema({ type: "string", nullable: false })).toEqual({ type: "string" });
    expect(toJsonSchema({ nullable: true })).toEqual({});
  });

  it("converts every nested sub-schema", () => {
    const schema = {
      type: "object",
      properties: { a: nullableString },
      additionalProperties: nullableString,
      allOf: [nullableString],
      anyOf: [nullableString],
      oneOf: [nullableString],
      not: nullableString,
    };
    expect(toJsonSchema(schema)).toEqual({ type: "object", properties: { a: nullType }, additionalProperties: nullType, allOf: [nullType], anyOf: [nullType], oneOf: [nullType], not: nullType });
    expect(toJsonSchema({ type: "array", items: { type: "array", items: nullableString } })).toEqual({ type: "array", items: { type: "array", items: nullType } });
  });

  it("drops non-schema entries of schema lists and keeps boolean additionalProperties", () => {
    expect(toJsonSchema({ anyOf: [nullableString, 5, null, "x"], additionalProperties: false })).toEqual({ anyOf: [nullType], additionalProperties: false });
  });
});

describe("toJsonSchema required and bounds", () => {
  it("limits required to declared properties", () => {
    const schema = { type: "object", required: ["a", "missing", "toString", "constructor", "hasOwnProperty", 5], properties: { a: { type: "string" } } };
    expect(toJsonSchema(schema)?.required).toEqual(["a"]);
  });

  it("keeps required properties whose names shadow Object.prototype", () => {
    const schema = { type: "object", required: ["toString"], properties: { toString: { type: "string" } } };
    expect(toJsonSchema(schema)?.required).toEqual(["toString"]);
  });

  it("rewrites boolean exclusive bounds to draft-07 numbers", () => {
    expect(toJsonSchema({ type: "integer", minimum: 1, exclusiveMinimum: true })).toEqual({ type: "integer", exclusiveMinimum: 1 });
    expect(toJsonSchema({ type: "number", maximum: 10, exclusiveMaximum: true })).toEqual({ type: "number", exclusiveMaximum: 10 });
    expect(toJsonSchema({ type: "number", maximum: 10, exclusiveMaximum: false })).toEqual({ type: "number", maximum: 10 });
    expect(toJsonSchema({ type: "number", exclusiveMinimum: true })).toEqual({ type: "number" });
    expect(toJsonSchema({ type: "number", exclusiveMinimum: 3 })).toEqual({ type: "number", exclusiveMinimum: 3 });
  });
});

describe("toJsonSchema input handling", () => {
  it("does not mutate its input", () => {
    const schema = deepFreeze({
      type: "object",
      required: ["a", "zz"],
      properties: { a: { type: "integer", minimum: 0, exclusiveMinimum: true, nullable: true }, b: { type: "array", items: nullableString } },
      anyOf: [nullableString],
    });
    const before = structuredClone(schema);
    expect(() => toJsonSchema(schema)).not.toThrow();
    expect(schema).toEqual(before);
  });

  it("cuts a circular schema instead of recursing forever", () => {
    const node: Record<string, unknown> = { type: "object", nullable: true };
    node.properties = { self: node };
    node.items = node;
    expect(toJsonSchema(node)).toEqual({ type: ["object", "null"], properties: { self: {} }, items: {} });
  });

  it("stays fast on a schema that refers to itself many times", () => {
    const node: Record<string, unknown> = { type: "object" };
    node.properties = { a: node, b: node, c: node, d: { type: "array", items: node } };
    node.anyOf = [node, node];
    const started = performance.now();
    expect(toJsonSchema(node)).toMatchObject({ properties: { a: {}, d: { items: {} } } });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("returns undefined for anything but an object", () => {
    for (const v of [undefined, null, "string", 5, true, [], [{ type: "string" }]]) expect(toJsonSchema(v)).toBeUndefined();
  });
});

describe("checkShape with converted schemas", () => {
  const schema = { type: "object", required: ["toString"], properties: { toString: { type: "string" }, customer: { type: "string", nullable: true }, name: { type: "string" } } };

  it("accepts null for a nullable property and rejects it otherwise", () => {
    const shape = { type: "object" as const, required: [], properties: { toString: { type: "string" as const }, customer: { type: "null" as const }, name: { type: "null" as const } } };
    expect(checkShape(shape, schema, "ref").map((f) => `${f.rule}:${f.property}`)).toEqual(["type-mismatch:name"]);
  });

  it("reports a required toString property as missing when absent", () => {
    const findings = checkShape({ type: "object", required: [], properties: { customer: { type: "string" } } }, schema, "ref");
    expect(findings).toEqual([{ rule: "missing-required", severity: "medium", property: "toString", message: 'required property "toString" is missing', specRef: "ref" }]);
  });
});
