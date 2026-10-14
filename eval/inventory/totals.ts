import type { Report } from "../../src/report/schema.js";
import { inventorySays, matchEntries, providerClass, type Match, type ProviderClass } from "./match.js";
import type { Inventory, InventoryEntry } from "./read.js";
import type { ScanOutcome } from "./reports.js";

export const SUPABASE = "@supabase/supabase-js";
/** #8: third-party calls that may stay `unknown` or `env:*`. */
export const UNRESOLVED_TARGET = 10;

type Split = Record<ProviderClass, number>;

/** What the default output prints: counts only, nothing named after a repository, a file, a host or the code. */
export interface Totals {
  repositories: number;
  tolerance: number;
  recall: {
    entries: number;
    matched: number;
    /** Matched at the entry's own line. */
    sameLine: number;
    /** Matched by a call reported at a caller of a wrapper (`via`). */
    throughWrapper: number;
    /** Not matched, in a repository whose scan stopped. */
    missedInStoppedScans: number;
    /** In a file outside the scanned subdirectory (counted in `entries`, never matched). */
    outsideScannedDir: number;
    /** Inventory rows left out: an invalid row, or a repository that is not in the run. */
    rejectedRows: number;
    otherRepositoryRows: number;
  };
  scans: { completed: number; stopped: number; complete: number; partial: number; reasons: Record<string, { entries: number; repositories: number }> };
  supabase: { repositories: number; status: Record<string, number> };
  sdkStatus: Record<string, number>;
  providers: {
    matched: Split;
    thirdParty: Split;
    /** Third-party according to the inventory, or (when it does not say) to the report: any provider but `internal`. */
    thirdPartyFromInventory: number;
    thirdPartyFromReport: number;
    thirdPartyUnresolved: number;
    target: number;
  };
  calls: { reported: number; throughWrapper: number };
}

/** One repository, for `--detail` only: never posted. */
export interface RepoDetail {
  name: string;
  scan: "complete" | "partial" | "stopped";
  error?: string;
  entries: number;
  matched: number;
  missed: InventoryEntry[];
  thirdPartyUnresolved: number;
  supabase?: string;
}

const split = (): Split => ({ resolved: 0, internal: 0, unknown: 0, env: 0 });

function bump(rec: Record<string, number>, key: string, by = 1): void {
  rec[key] = (rec[key] ?? 0) + by;
}

/** Why a partial report is partial, per reason: the entries of `diagnostics` that make `complete` false. */
function reasonsOf(report: Report): Map<string, number> {
  const d = report.diagnostics;
  const out = new Map<string, number>();
  const add = (key: string): void => void out.set(key, (out.get(key) ?? 0) + 1);
  for (const s of d?.skipped ?? []) if (s.reason === "parse-error" || s.reason === "internal-error") add(`skipped: ${s.reason}`);
  for (const c of d?.droppedCalls ?? []) add(`dropped call: ${c.reason}`);
  for (const u of d?.unfollowed ?? []) add(`not followed: ${u.reason}`);
  return out;
}

function addScan(t: Totals, report: Report | undefined): void {
  if (!report) {
    t.scans.stopped++;
    return;
  }
  t.scans.completed++;
  if (report.diagnostics?.complete === false) t.scans.partial++;
  else t.scans.complete++;
  for (const [reason, n] of reasonsOf(report)) {
    const r = (t.scans.reasons[reason] ??= { entries: 0, repositories: 0 });
    r.entries += n;
    r.repositories++;
  }
  for (const sdk of report.coverage?.sdks ?? []) bump(t.sdkStatus, sdk.status);
  const supabase = report.coverage?.sdks.find((s) => s.package === SUPABASE);
  if (supabase) {
    t.supabase.repositories++;
    bump(t.supabase.status, supabase.status);
  }
  t.calls.reported += report.calls.length;
  t.calls.throughWrapper += report.calls.filter((c) => c.via).length;
}

/** Adds one repository's matches; returns its third-party calls that stay `unknown` or `env:*`. */
function addMatches(t: Totals, matches: Match[], stopped: boolean): number {
  let unresolved = 0;
  for (const m of matches) {
    t.recall.entries++;
    if (m.outside) t.recall.outsideScannedDir++;
    if (!m.call) {
      if (stopped) t.recall.missedInStoppedScans++;
      continue;
    }
    t.recall.matched++;
    if (m.call.location.line === m.entry.line) t.recall.sameLine++;
    if (m.call.via) t.recall.throughWrapper++;
    const cls = providerClass(m.call.provider);
    t.providers.matched[cls]++;
    const says = inventorySays(m.entry);
    if (says === "internal" || (says === undefined && cls === "internal")) continue;
    if (says) t.providers.thirdPartyFromInventory++;
    else t.providers.thirdPartyFromReport++;
    t.providers.thirdParty[cls]++;
    if (cls === "unknown" || cls === "env") unresolved++;
  }
  t.providers.thirdPartyUnresolved += unresolved;
  return unresolved;
}

function emptyTotals(repositories: number, tolerance: number, inventory: Inventory): Totals {
  return {
    repositories,
    tolerance,
    recall: { entries: 0, matched: 0, sameLine: 0, throughWrapper: 0, missedInStoppedScans: 0, outsideScannedDir: 0, rejectedRows: inventory.rejected, otherRepositoryRows: 0 },
    scans: { completed: 0, stopped: 0, complete: 0, partial: 0, reasons: {} },
    supabase: { repositories: 0, status: {} },
    sdkStatus: {},
    providers: { matched: split(), thirdParty: split(), thirdPartyFromInventory: 0, thirdPartyFromReport: 0, thirdPartyUnresolved: 0, target: UNRESOLVED_TARGET },
    calls: { reported: 0, throughWrapper: 0 },
  };
}

/** The four checks of #114 over every repository, and a line per repository for `--detail`. */
export function computeTotals(outcomes: ScanOutcome[], inventory: Inventory, tolerance: number): { totals: Totals; details: RepoDetail[] } {
  const t = emptyTotals(outcomes.length, tolerance, inventory);
  const byRepo = new Map<string, InventoryEntry[]>();
  for (const e of inventory.entries) {
    if (!byRepo.has(e.repo)) byRepo.set(e.repo, []);
    byRepo.get(e.repo)!.push(e);
  }
  const details = outcomes.map(({ repo, report, error }): RepoDetail => {
    const entries = byRepo.get(repo.name) ?? [];
    byRepo.delete(repo.name);
    addScan(t, report);
    const matches = matchEntries(entries, report?.calls ?? [], repo.subdir, tolerance);
    const unresolved = addMatches(t, matches, !report);
    const scanState = !report ? "stopped" : report.diagnostics?.complete === false ? "partial" : "complete";
    const supabase = report?.coverage?.sdks.find((s) => s.package === SUPABASE)?.status;
    const missed = matches.filter((m) => !m.call).map((m) => m.entry);
    return { name: repo.name, scan: scanState, ...(error ? { error } : {}), entries: entries.length, matched: entries.length - missed.length, missed, thirdPartyUnresolved: unresolved, ...(supabase ? { supabase } : {}) };
  });
  for (const rest of byRepo.values()) t.recall.otherRepositoryRows += rest.length;
  return { totals: t, details };
}
