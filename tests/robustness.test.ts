import { describe, expect, it } from "vitest";
import { toJson } from "../src/report/json.js";
import type { Call, Report } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

describe("scan robustness", () => {
  it("skips a file with a non-literal module specifier and keeps scanning", async () => {
    const warnings: string[] = [];
    const r = await scanFixture("robustness/bad-specifier", { onWarning: (m) => warnings.push(m) });
    expect(warnings).toEqual(["skipped broken.ts: Expected the module specifier to be a string literal."]);
    expect(at(r, "ok.ts", 5)).toMatchObject({ provider: "github", pathTemplate: "/rate_limit" });
    expect(r.diagnostics).toMatchObject({
      filesSeen: 2,
      filesScanned: 1,
      skipped: [{ file: "broken.ts", reason: "parse-error", detail: "Expected the module specifier to be a string literal." }],
      complete: false,
    });
  });

  it("keeps odd body values inside the report schema", async () => {
    const warnings: string[] = [];
    const r = await scanFixture("robustness/odd-body", { onWarning: (m) => warnings.push(m) });
    expect(warnings).toEqual([]);
    expect(at(r, "client.ts", 4).body).toEqual({
      type: "object",
      properties: {
        config: {
          type: "object",
          properties: {
            targetTimeoutMs: { type: "object", properties: { type: { type: "integer", enum: [5] } }, required: ["type"] },
            timeoutMs: { type: "integer", enum: [30000] },
            retries: { type: "integer", enum: [3] },
          },
          required: ["targetTimeoutMs", "timeoutMs", "retries"],
        },
      },
      required: ["config"],
    });
  });

  it("drops a call that fails the schema instead of losing the report", async () => {
    const r = await scanFixture("robustness/odd-body");
    const good = r.calls[0]!;
    const bad = { ...good, id: "bad", body: { type: "number", enum: [Number.NaN] } } as unknown as Call;
    const warnings: string[] = [];
    const out = JSON.parse(toJson({ ...r, calls: [good, bad] }, false, (m) => warnings.push(m))) as Report;
    expect(out.calls.map((c) => c.id)).toEqual([good.id]);
    expect(out.stats.callsFound).toBe(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^dropped call at client\.ts:4: body: /);
    expect(out.diagnostics).toMatchObject({ droppedCalls: [{ file: "client.ts", line: 4, reason: "schema-invalid" }], complete: false });
  });
});
