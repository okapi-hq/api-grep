import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runInventory, type InventoryOptions } from "../eval/inventory/run.js";
import { inProcessScanner, type Scanner } from "../eval/inventory/reports.js";
import { FIXTURES } from "./fixture-helpers.js";

/**
 * `pnpm eval:inventory` (#114) on an invented two-repository evaluation: `demo-shop` (TypeScript: Supabase, Stripe, a
 * wrapper, an env host, an injected fetch) and `demo-notes` (Python, scanned at `service/`). The inventory has hits,
 * a hit two lines off, two entries on one line, misses, an entry outside the scanned subdirectory, an invalid row and
 * a row of a repository that is not in the run.
 */
const DIR = path.join(FIXTURES, "eval-inventory");
const ROOT = path.resolve(FIXTURES, "..", "..");
const tmp = mkdtempSync(path.join(os.tmpdir(), "api-grep-inventory-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const base: InventoryOptions = {
  repos: path.join(DIR, "repos"),
  inventory: path.join(DIR, "inventory.csv"),
  manifest: path.join(DIR, "manifest.json"),
  tolerance: 3,
  timeoutMs: 60_000,
};

/** Names, paths, hosts and code of the fixture: none may reach the default output. */
const PRIVATE = ["demo-shop", "demo-notes", "other-repo", "orders.ts", "client.py", "src/", "github.com", "localhost", "WEATHER_API_URL", "forecast-api", "partner-api", "fetchFn", "/api"];

describe("eval:inventory totals", () => {
  it("counts the four checks of #114", async () => {
    const { totals } = await runInventory(base, inProcessScanner());
    expect(totals.recall).toEqual({ entries: 15, matched: 12, sameLine: 11, throughWrapper: 1, missedInStoppedScans: 0, outsideScannedDir: 1, rejectedRows: 1, otherRepositoryRows: 1 });
    expect(totals.scans).toEqual({ completed: 2, stopped: 0, complete: 1, partial: 1, reasons: { "not followed: injected-fetch": { entries: 1, repositories: 1 } } });
    expect(totals.supabase).toEqual({ repositories: 1, status: { ok: 1 } });
    expect(totals.sdkStatus).toEqual({ ok: 2 });
    expect(totals.providers).toEqual({
      matched: { resolved: 7, internal: 3, unknown: 1, env: 1 },
      thirdParty: { resolved: 7, internal: 0, unknown: 1, env: 1 },
      thirdPartyFromInventory: 8,
      thirdPartyFromReport: 1,
      thirdPartyUnresolved: 2,
      target: 10,
    });
    expect(totals.calls).toEqual({ reported: 13, throughWrapper: 2 });
  });

  it("counts a scan that stops, and the inventory entries it leaves unmatched", async () => {
    const scan = inProcessScanner();
    const stopping: Scanner = (repo) => (repo.name === "demo-notes" ? Promise.resolve({ repo, error: "exit 1" }) : scan(repo));
    const { totals, details } = await runInventory(base, stopping);
    expect(totals.scans).toMatchObject({ completed: 1, stopped: 1 });
    expect(totals.recall).toMatchObject({ entries: 15, matched: 8, missedInStoppedScans: 5 });
    expect(details.find((d) => d.name === "demo-notes")).toMatchObject({ scan: "stopped", error: "exit 1", matched: 0, entries: 5 });
  });

  it("matches nothing beyond the tolerance, and reuses saved reports", async () => {
    const out = path.join(tmp, "reports");
    await runInventory({ ...base, out }, inProcessScanner(out));
    const strict = await runInventory({ ...base, reports: out, tolerance: 0 });
    expect(strict.totals.recall).toMatchObject({ matched: 11, sameLine: 11 });
    const missing = await runInventory({ ...base, reports: path.join(tmp, "none") });
    expect(missing.totals.scans).toMatchObject({ completed: 0, stopped: 2 });
  });

});

describe("eval:inventory output", () => {
  it("prints totals only by default, and names repositories and paths with --detail", async () => {
    const { output } = await runInventory(base, inProcessScanner());
    expect(output).toContain("Inventory call sites found: **12 / 15 (80.0%)**");
    expect(output).toContain("Third-party calls still `unknown` or `env:*`: 2** (target: at most 10)");
    for (const word of PRIVATE) expect(output, word).not.toContain(word);
    const json = await runInventory({ ...base, json: true }, inProcessScanner());
    for (const word of PRIVATE) expect(json.output, word).not.toContain(word);
    const detail = await runInventory({ ...base, detail: true }, inProcessScanner());
    expect(detail.output).toContain("do not post");
    expect(detail.output).toContain("- demo-shop: scan partial");
    expect(detail.output).toContain("  - missed src/sync.ts:5");
  });

  it("runs as a command, each scan in a child process with a 2 GB heap", () => {
    const args = ["--import", "tsx", "eval/inventory.ts", "--repos", base.repos, "--inventory", base.inventory, "--manifest", base.manifest!];
    const output = execFileSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    expect(output).toContain("**12 / 15 (80.0%)**");
    expect(output).toContain("**stopped: 0**");
    for (const word of PRIVATE) expect(output, word).not.toContain(word);
  });
});
