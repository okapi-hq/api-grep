import type { Call } from "../../src/report/schema.js";
import type { InventoryEntry } from "./read.js";

/** An inventory entry and the reported call matched to it, if any. */
export interface Match {
  entry: InventoryEntry;
  call?: Call;
  /** The entry's file is outside the scanned subdirectory: no report call can match it. */
  outside: boolean;
}

/** The entry's file relative to the scanned directory, or undefined when it is outside `subdir`. */
function scannedPath(file: string, subdir: string): string | undefined {
  if (!subdir) return file;
  return file.startsWith(`${subdir}/`) ? file.slice(subdir.length + 1) : undefined;
}

interface Pair {
  entry: number;
  call: Call;
  distance: number;
}

/**
 * Pairs inventory entries with reported calls of the same file whose line is at most `tolerance` lines away, each call
 * used once: two entries on one line need two calls there. Nearest pairs win, and a direct call wins over a call
 * reported through a wrapper (`via`) at the same distance.
 *
 * Wrappers: the inventory lists one entry per call site, at the helper that makes the request. api-grep reports the
 * helper's own request at that line too, so that entry matches the direct call. The calls api-grep adds at each caller
 * of the helper (`via` set, located at the caller) only match entries the inventory has at those callers.
 */
export function matchEntries(entries: InventoryEntry[], calls: Call[], subdir: string, tolerance: number): Match[] {
  const byFile = new Map<string, Call[]>();
  for (const c of calls) {
    const list = byFile.get(c.location.file) ?? [];
    list.push(c);
    byFile.set(c.location.file, list);
  }
  const paths = entries.map((e) => scannedPath(e.file, subdir));
  const pairs: Pair[] = [];
  entries.forEach((e, i) => {
    for (const call of byFile.get(paths[i] ?? "") ?? []) {
      const distance = Math.abs(call.location.line - e.line);
      if (paths[i] !== undefined && distance <= tolerance) pairs.push({ entry: i, call, distance });
    }
  });
  pairs.sort((a, b) => a.distance - b.distance || Number(!!a.call.via) - Number(!!b.call.via) || a.entry - b.entry);
  const matched = new Map<number, Call>();
  const used = new Set<Call>();
  for (const p of pairs) {
    if (matched.has(p.entry) || used.has(p.call)) continue;
    matched.set(p.entry, p.call);
    used.add(p.call);
  }
  return entries.map((entry, i) => ({ entry, call: matched.get(i), outside: paths[i] === undefined }));
}

export type ProviderClass = "resolved" | "internal" | "unknown" | "env";

export function providerClass(provider: string): ProviderClass {
  if (provider === "internal" || provider === "unknown") return provider;
  return provider.startsWith("env:") ? "env" : "resolved";
}

const INTERNAL = new Set(["internal", "first-party", "own", "self", "backend"]);
const THIRD_PARTY = new Set(["third-party", "thirdparty", "external", "3p"]);

/**
 * Whether the inventory says the call goes to a third party: `kind` when it is `third-party` or `internal` (or a
 * synonym), else `service` (empty: not said; the repository's own name or `internal`: its own backend).
 */
export function inventorySays(entry: InventoryEntry): "third-party" | "internal" | undefined {
  if (THIRD_PARTY.has(entry.kind)) return "third-party";
  if (INTERNAL.has(entry.kind)) return "internal";
  const service = entry.service.toLowerCase();
  if (!service) return undefined;
  return INTERNAL.has(service) || service === entry.repo.toLowerCase() ? "internal" : "third-party";
}
