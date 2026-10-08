import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { reportJsonSchema } from "../src/report/json-schema.js";
import { SCHEMA_URL, SCHEMA_VERSION } from "../src/report/schema.js";
import { scanFixture } from "./fixture-helpers.js";

const committed = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "schema", "report.v1.json"), "utf8")) as Record<string, unknown>;

describe("report contract", () => {
  it("schema/report.v1.json is up to date (run `pnpm gen:schema`)", () => {
    expect(committed).toEqual(reportJsonSchema());
  });

  it("scan reports validate against the committed JSON Schema", async () => {
    const validate = new Ajv({ allErrors: true }).compile(committed);
    for (const name of ["sdk", "diagnostics", "coverage"]) {
      const report = await scanFixture(name, { exclude: [] });
      expect(report.calls.length).toBeGreaterThan(0);
      expect(validate(report) ? [] : validate.errors).toEqual([]);
    }
    const report = await scanFixture("fetch");
    delete (report.calls[0]!.location as { language?: string }).language;
    expect(validate(report)).toBe(false);
  });

  it("names its schema and version, and the language of every call", async () => {
    const report = await scanFixture("fetch");
    expect(report).toMatchObject({ $schema: SCHEMA_URL, schemaVersion: SCHEMA_VERSION });
    expect(committed.$id).toBe(SCHEMA_URL);
    expect(report.calls.every((c) => c.location.language === "typescript")).toBe(true);
    expect(report.stats.byLanguage).toEqual({ typescript: report.calls.length });
  });
});
