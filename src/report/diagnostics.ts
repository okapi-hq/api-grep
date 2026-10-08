import type { Coverage, Diagnostics, DroppedCall, SkippedFile, UnfollowedCall } from "./schema.js";

/** Files left out by --exclude / --include are listed one by one up to this count, then only counted. */
const MAX_LISTED_EXCLUSIONS = 200;
const REQUESTED: SkippedFile["reason"][] = ["excluded", "not-included"];

/** Collects what a scan could not read, so a partial report never looks complete. */
export class DiagnosticsCollector {
  readonly skipped: SkippedFile[] = [];
  readonly droppedCalls: DroppedCall[] = [];
  readonly unfollowed: UnfollowedCall[] = [];

  constructor(private readonly onWarning?: (message: string) => void) {}

  skip(entry: SkippedFile): void {
    this.skipped.push(entry);
    if (!REQUESTED.includes(entry.reason)) this.onWarning?.(`skipped ${entry.file}: ${entry.detail ?? entry.reason}`);
  }

  drop(entry: DroppedCall): void {
    this.droppedCalls.push(entry);
    this.onWarning?.(`dropped call at ${entry.file}:${entry.line}: ${entry.detail ?? entry.reason}`);
  }

  unfollow(entry: UnfollowedCall): void {
    this.unfollowed.push(entry);
  }

  finish(filesSeen: number, filesScanned: number): Diagnostics {
    const skippedCounts: Record<string, number> = {};
    for (const s of this.skipped) skippedCounts[s.reason] = (skippedCounts[s.reason] ?? 0) + 1;
    const requested = this.skipped.filter((s) => REQUESTED.includes(s.reason));
    const lost = this.skipped.filter((s) => !REQUESTED.includes(s.reason));
    const skipped = requested.length > MAX_LISTED_EXCLUSIONS ? lost : this.skipped;
    const complete = lost.length === 0 && this.droppedCalls.length === 0 && this.unfollowed.length === 0;
    return { filesSeen, filesScanned, skipped, skippedCounts, droppedCalls: this.droppedCalls, unfollowed: this.unfollowed, complete };
  }
}

/** `1 call`, `3 calls`. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** `scanned 1702/1840 files, 3 skipped, 12 calls not followed, 1 call dropped` (or `..., complete`). */
export function diagnosticsLine(d: Diagnostics): string {
  const parts = [`scanned ${d.filesScanned}/${d.filesSeen} files`];
  const skipped = Object.values(d.skippedCounts).reduce((a, b) => a + b, 0);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (d.unfollowed.length > 0) parts.push(`${plural(d.unfollowed.length, "call", "calls")} not followed`);
  if (d.droppedCalls.length > 0) parts.push(`${plural(d.droppedCalls.length, "call", "calls")} dropped`);
  if (d.complete) parts.push("complete");
  return parts.join(", ");
}

/** One warning line per SDK whose calls are missing from the report. */
export function coverageWarnings(coverage: Coverage): string[] {
  const out: string[] = [];
  for (const s of coverage.sdks) {
    const where = `imported in ${plural(s.importSites, "file", "files")}`;
    if (s.status === "unsupported") out.push(`${s.package} ${where}, no registry: its calls are not listed`);
    if (s.status === "imported-no-calls") out.push(`${s.package} ${where}, but no call was found (used through a wrapper?)`);
  }
  return out;
}
