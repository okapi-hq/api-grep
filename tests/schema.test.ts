import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { callId } from "../src/assemble.js";
import { reportJsonSchema } from "../src/report/json-schema.js";
import { finalizeReport } from "../src/report/json.js";
import { OperationSchema, SCHEMA_URL, SCHEMA_VERSION, type Report } from "../src/report/schema.js";
import { computeStats } from "../src/scan.js";
import { FIXTURES, scanFixture } from "./fixture-helpers.js";

const committed = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "schema", "report.v1.json"), "utf8")) as Record<string, unknown>;
/** A report as the protocol front ends (#34 to #36) will write it: one call per protocol, `from` and optional field. */
const operations = (): Report => JSON.parse(readFileSync(path.join(FIXTURES, "report", "operations.json"), "utf8")) as Report;

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

describe("operation", () => {
  const validate = new Ajv({ allErrors: true }).compile(committed);

  it("a report with every kind of operation validates against the committed JSON Schema", () => {
    const report = operations();
    expect(validate(report) ? [] : validate.errors).toEqual([]);
    expect(report.stats).toEqual(computeStats(report.calls, 5, 0));
  });

  it("the fixture covers every protocol, every source and every optional field", () => {
    const ops = operations().calls.map((c) => c.operation!);
    expect(new Set(ops.map((o) => o.protocol))).toEqual(new Set(OperationSchema.shape.protocol.options));
    expect(new Set(ops.map((o) => o.from))).toEqual(new Set(OperationSchema.shape.from.options));
    expect(new Set(ops.flatMap((o) => Object.keys(o)))).toEqual(new Set(Object.keys(OperationSchema.shape)));
    expect(ops.some((o) => o.name === null)).toBe(true);
  });

  it("ids hash the operation name: a batch is one call per operation, each with its own id", () => {
    const { calls } = operations();
    for (const c of calls) expect(c.id).toBe(callId(c.location, 0, c.operation?.name));
    expect(new Set(calls.map((c) => c.id)).size).toBe(calls.length);
    const batch = calls.filter((c) => c.operation?.batch);
    expect(batch.map((c) => c.operation!.name)).toEqual(["getBalance", "getSlot"]);
    expect(new Set(batch.map((c) => `${c.location.line}:${c.location.col} ${JSON.stringify(c.body)}`)).size).toBe(1);
  });

  it("the written report keeps every operation", () => {
    const report = operations();
    const warnings: string[] = [];
    const written = finalizeReport(structuredClone(report), (w) => warnings.push(w));
    expect(warnings).toEqual([]);
    expect(written.calls.map((c) => c.operation)).toEqual(report.calls.map((c) => c.operation));
  });

  it.each([
    ["an unknown protocol", { protocol: "rest" }],
    ["a missing name", { name: undefined }],
    ["a name that is not a string", { name: 42 }],
    ["a missing dynamic", { dynamic: undefined }],
    ["an unknown source", { from: "path" }],
    ["an unknown GraphQL type", { type: "fragment" }],
    ["fields that are not strings", { fields: [1] }],
    ["alternatives that are not strings", { alternatives: [null] }],
    ["arguments that are not by name", { arguments: { order: [1] } }],
  ])("rejects %s", (_, change) => {
    const report = operations();
    const call = report.calls[0]!;
    call.operation = JSON.parse(JSON.stringify({ ...call.operation, ...change })) as typeof call.operation;
    expect(validate(report)).toBe(false);
    const warnings: string[] = [];
    const written = finalizeReport(report, (w) => warnings.push(w));
    expect(written.calls.map((c) => c.id)).toEqual(report.calls.slice(1).map((c) => c.id));
    expect(warnings).toEqual([expect.stringContaining(": operation.")]);
  });
});
