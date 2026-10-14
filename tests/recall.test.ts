import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import type { Report } from "../src/report/schema.js";
import { FIXTURES, scanFixture } from "./fixture-helpers.js";

/**
 * Regression fixtures: each directory with an `expected.json` lists the calls a scan must find (file, line, provider).
 * An empty list marks a negative fixture: any call there is a false call. `orUnfollowed` accepts a
 * `diagnostics.unfollowed` entry instead of a call; `todo` (an issue URL) parks a fixture whose feature is not built yet.
 * `operation` is the `operation.name` the call must carry (a JSON-RPC method, a GraphQL operation); `arguments`, its
 * `operation.arguments` exactly (`null` for none).
 */
interface Expected {
  issue: string;
  todo?: string;
  skipped?: string[];
  calls: { file: string; line: number; provider: string; operation?: string; arguments?: unknown; orUnfollowed?: boolean }[];
}

const baseline = JSON.parse(readFileSync(path.join(FIXTURES, "..", "recall-baseline.json"), "utf8")) as { recall: number; falseCalls: number };

function fixturesWithExpectations(rel = ""): string[] {
  const dir = path.join(FIXTURES, rel);
  const here = existsSync(path.join(dir, "expected.json")) ? [rel] : [];
  const subdirs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  return [...here, ...subdirs.flatMap((d) => fixturesWithExpectations(rel ? `${rel}/${d.name}` : d.name))];
}

function found(r: Report, e: Expected["calls"][number]): boolean {
  const same = (c: Report["calls"][number]): boolean =>
    c.location.file === e.file && c.location.line === e.line && c.provider === e.provider && (e.operation === undefined || c.operation?.name === e.operation) &&
    (e.arguments === undefined || isDeepStrictEqual(c.operation?.arguments ?? null, e.arguments));
  if (r.calls.some(same)) return true;
  return !!e.orUnfollowed && !!r.diagnostics?.unfollowed.some((u) => u.file === e.file && u.line === e.line);
}

const totals = { expected: 0, matched: 0, falseCalls: 0 };

describe("regression fixtures", () => {
  for (const name of fixturesWithExpectations()) {
    const exp = JSON.parse(readFileSync(path.join(FIXTURES, name, "expected.json"), "utf8")) as Expected;
    if (exp.todo) {
      it.todo(`${name} (${exp.todo})`);
      continue;
    }
    it(name, async () => {
      const r = await scanFixture(name, { examples: 0 });
      const missing = exp.calls.filter((e) => !found(r, e));
      totals.expected += exp.calls.length;
      totals.matched += exp.calls.length - missing.length;
      if (exp.calls.length === 0) totals.falseCalls += r.calls.length;
      expect(r.calls.map((c) => `${c.location.file}:${c.location.line} ${c.provider} ${c.method} ${c.pathTemplate}${c.operation ? ` ${c.operation.name}` : ""}${c.via ? ` (${c.via})` : ""}`)).toMatchSnapshot();
      if (exp.skipped) expect(r.diagnostics?.skipped.map((s) => s.file)).toEqual(exp.skipped);
      expect(missing, `missing calls in ${name} (${exp.issue})`).toEqual([]);
    });
  }

  it("keeps recall at or above the recorded baseline, with no false calls", () => {
    const recall = totals.expected === 0 ? 1 : totals.matched / totals.expected;
    const line = `recall ${recall.toFixed(2)}, false calls ${totals.falseCalls}`;
    process.stdout.write(`${line}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line} (${totals.matched}/${totals.expected} expected calls)\n`);
    expect(recall).toBeGreaterThanOrEqual(baseline.recall);
    expect(totals.falseCalls).toBeLessThanOrEqual(baseline.falseCalls);
  });
});
