import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type HttpError } from "../../src/server/errors.js";
import { type RunOptions, runScan } from "../../src/server/run-scan.js";

/** A stand-in for the CLI: `node fake.mjs scan <dir> --json <mode>` behaves as `mode` says. */
const root = mkdtempSync(path.join(tmpdir(), "api-grep-run-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const fake = path.join(root, "fake.mjs");
writeFileSync(
  fake,
  `const [, , command, dir, json, mode] = process.argv;
if (command !== "scan" || json !== "--json") process.exit(9);
if (mode === "ok") process.stdout.write(JSON.stringify({ dir, env: process.env }));
if (mode === "partial") { process.stdout.write("{}"); process.exitCode = 2; }
if (mode === "fail") { process.stderr.write("cannot read " + dir + "/src/a.ts\\nmore"); process.exitCode = 1; }
if (mode === "oom") { process.stderr.write("FATAL ERROR: Reached heap limit Allocation failed"); process.exitCode = 134; }
if (mode === "loud") process.stdout.write("x".repeat(4096));
if (mode === "hang") setInterval(() => {}, 1000);
`,
);

const options = (over: Partial<RunOptions> = {}): RunOptions => ({ timeoutMs: 10_000, maxReportBytes: 1024, heapMb: 0, root, ...over });
const run = (mode: string, over: Partial<RunOptions> = {}): Promise<string> => runScan(fake, path.join(root, "archive", "repo"), [mode], options(over));
const failure = (p: Promise<unknown>): Promise<HttpError> => p.then(() => Promise.reject(new Error("resolved")), (e: HttpError) => e);

describe("runScan", () => {
  it("returns the report of a complete or partial scan", async () => {
    expect((JSON.parse(await run("ok")) as { dir: string }).dir).toBe(path.join(root, "archive", "repo"));
    expect(await run("partial")).toBe("{}");
  });

  it("gives the scan none of the server's variables", async () => {
    process.env.API_GREP_TOKEN = "server-secret-token";
    try {
      const { env } = JSON.parse(await run("ok", { maxReportBytes: 1024 * 1024 })) as { env: Record<string, string> };
      expect(env.API_GREP_TOKEN).toBeUndefined();
      expect(env).toMatchObject({ API_GREP_NO_RESPAWN: "1", GIT_CEILING_DIRECTORIES: root });
    } finally {
      delete process.env.API_GREP_TOKEN;
    }
  });

  it("reports a failure with the archive's paths and without the server's directories", async () => {
    const err = await failure(run("fail"));
    expect(err).toMatchObject({ status: 500, code: "scan_failed", message: "the scan failed: cannot read <archive>/src/a.ts" });
    expect(await failure(run("oom"))).toMatchObject({ code: "scan_out_of_memory" });
  });

  it("kills a scan past its timeout, its report limit or its client", async () => {
    expect(await failure(run("hang", { timeoutMs: 300 }))).toMatchObject({ status: 504, code: "scan_timeout" });
    expect(await failure(run("loud", { maxReportBytes: 100 }))).toMatchObject({ code: "report_too_large" });
    const gone = new AbortController();
    setTimeout(() => gone.abort(), 200);
    expect(await failure(run("hang", { signal: gone.signal }))).toMatchObject({ code: "client_closed" });
  });
});
