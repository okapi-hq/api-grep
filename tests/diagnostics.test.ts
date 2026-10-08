import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diagnosticsLine } from "../src/report/diagnostics.js";
import { at, FIXTURES, scanFixture } from "./fixture-helpers.js";

describe("diagnostics", () => {
  it("lists what the scan could not read and still reports everything else", async () => {
    const r = await scanFixture("diagnostics", { exclude: [] });
    expect(r.diagnostics).toEqual({
      filesSeen: 5,
      filesScanned: 4,
      skipped: [{ file: "src/broken.ts", reason: "parse-error", detail: "Expression expected." }],
      skippedCounts: { "parse-error": 1 },
      droppedCalls: [],
      unfollowed: [
        { file: "src/injected.ts", line: 16, reason: "injected-fetch", expr: "deps.fetchUpstream" },
        { file: "src/two-hop.ts", line: 10, reason: "wrapper-depth", via: "doFetch" },
      ],
      complete: false,
    });
    // outside the tsconfig `include`, still scanned
    expect(at(r, "scripts/outside.ts", 2)).toMatchObject({ method: "POST", pathTemplate: "/v1/seed" });
    // the injected fetcher's default and a `typeof fetch` parameter are fetch calls
    expect(at(r, "src/injected.ts", 10)).toMatchObject({ client: "fetch", pathTemplate: "/health" });
    expect(at(r, "src/injected.ts", 20)).toMatchObject({ client: "fetch", host: "files.example.com", pathTemplate: "/v1/files/{id}" });
    expect(r.calls.some((c) => c.location.file === "src/injected.ts" && c.location.line === 26)).toBe(false);
    expect(at(r, "src/body.ts", 2).body).toMatchObject({ properties: { config: { properties: { timeoutMs: { enum: [30000] } } } } });
  });

  it("lists files left out by --exclude without marking the scan incomplete", async () => {
    const r = await scanFixture("fetch", { exclude: ["env.ts"] });
    expect(r.diagnostics).toMatchObject({ skipped: [{ file: "env.ts", reason: "excluded" }], skippedCounts: { excluded: 1 }, complete: true });
    expect(r.diagnostics!.filesSeen).toBe(r.diagnostics!.filesScanned + 1);
  });

  it("summarizes coverage in one line", () => {
    const base = { filesSeen: 1840, filesScanned: 1702, skipped: [], skippedCounts: { "parse-error": 3, excluded: 135 }, droppedCalls: [], unfollowed: [], complete: false };
    expect(diagnosticsLine(base)).toBe("scanned 1702/1840 files, 138 skipped");
    const unfollowed = Array.from({ length: 12 }, (_, i) => ({ file: "a.ts", line: i, reason: "injected-fetch" as const }));
    expect(diagnosticsLine({ ...base, unfollowed })).toBe("scanned 1702/1840 files, 138 skipped, 12 calls not followed");
    expect(diagnosticsLine({ ...base, skippedCounts: {}, filesScanned: 1840, complete: true })).toBe("scanned 1840/1840 files, complete");
  });
});

describe("cli exit codes", () => {
  const run = (dir: string): number | null =>
    spawnSync(process.execPath, ["--import", "tsx", path.join(FIXTURES, "..", "..", "src", "cli.ts"), "scan", dir, "--json"], {
      env: { ...process.env, APICALLS_NO_RESPAWN: "1" },
      encoding: "utf8",
    }).status;

  it("exits 0 when complete, 2 when partial, 1 on a fatal error", () => {
    expect(run(path.join(FIXTURES, "gotky"))).toBe(0);
    expect(run(path.join(FIXTURES, "robustness", "bad-specifier"))).toBe(2);
    expect(run(path.join(FIXTURES, "no-such-dir"))).toBe(1);
  });
});
