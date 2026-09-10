import { describe, expect, it } from "vitest";
import { checkShape } from "../../src/validate/check.js";
import type { Shape } from "../../src/types.js";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["amount", "currency"],
  properties: {
    amount: { type: "integer" },
    currency: { type: "string", enum: ["usd", "eur"] },
    description: { type: "string", deprecated: true },
    customer: { type: "string", nullable: true },
  },
};

describe("checkShape", () => {
  it("flags unknown, missing, mismatched and deprecated properties", () => {
    const shape: Shape = {
      type: "object",
      required: ["amount", "currency", "descriptin", "description"],
      properties: {
        amount: { type: "string" },
        currency: { type: "string", enum: ["gbp"] },
        descriptin: { type: "string" },
        description: { type: "string" },
      },
    };
    const findings = checkShape(shape, schema, "spec#x");
    expect(findings.map((f) => `${f.rule}:${f.property}`).sort()).toEqual([
      "deprecated:description",
      "enum-mismatch:currency",
      "type-mismatch:amount",
      "unknown-property:descriptin",
    ]);
  });

  it("does not report missing required when keys are dynamic", () => {
    const shape: Shape = { type: "object", required: [], properties: {}, dynamicKeys: true };
    expect(checkShape(shape, schema, "ref")).toEqual([]);
  });

  it("accepts integers for number schemas and skips dynamic shapes", () => {
    expect(checkShape({ type: "object", required: ["amount", "currency"], properties: { amount: { type: "integer", enum: [5] }, currency: { type: "string", enum: ["usd"] } } }, schema, "r")).toEqual([]);
    expect(checkShape({ type: "dynamic", origin: "param" }, schema, "r")).toEqual([]);
  });
});
