import type { Coverage, Diagnostics, DroppedCall, HostCoverage, McpToolRefs, SkippedFile, UnfollowedCall } from "./schema.js";

/** Files left out by --exclude / --include are listed one by one up to this count, then only counted. */
const MAX_LISTED_EXCLUSIONS = 200;
const REQUESTED: SkippedFile["reason"][] = ["excluded", "not-included"];

/** Collects what a scan could not read, so a partial report never looks complete. */
export class DiagnosticsCollector {
  readonly skipped: SkippedFile[] = [];
  readonly droppedCalls: DroppedCall[] = [];
  readonly unfollowed: UnfollowedCall[] = [];
  /** `graphql-limit` / `host-table-limit` entries already listed: a wrapper reaching one twice from one place lists it once. */
  private readonly limits = new Set<string>();

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
    if (entry.reason === "graphql-limit" || entry.reason === "host-table-limit") {
      const key = `${entry.file}:${entry.line}:${entry.detail}`;
      if (this.limits.has(key)) return;
      this.limits.add(key);
    }
    this.unfollowed.push(entry);
  }

  finish(filesSeen: number, filesScanned: number, languages: Diagnostics["languages"] = {}): Diagnostics {
    const skippedCounts: Record<string, number> = {};
    for (const s of this.skipped) skippedCounts[s.reason] = (skippedCounts[s.reason] ?? 0) + 1;
    const requested = this.skipped.filter((s) => REQUESTED.includes(s.reason));
    const lost = this.skipped.filter((s) => !REQUESTED.includes(s.reason));
    const skipped = requested.length > MAX_LISTED_EXCLUSIONS ? lost : this.skipped;
    const complete = lost.length === 0 && this.droppedCalls.length === 0 && this.unfollowed.length === 0;
    return { filesSeen, filesScanned, skipped, skippedCounts, droppedCalls: this.droppedCalls, unfollowed: this.unfollowed, languages, complete };
  }
}

/** `1 call`, `3 calls`. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * `scanned 1702/1840 files, 3 skipped, 12 calls not followed, 2 GraphQL documents not fully read, 1 host table too
 * large to list, 1 call dropped` (or `..., complete`); with several languages, the files of each: `scanned 40/40 files (typescript 30, python 10), complete`.
 */
export function diagnosticsLine(d: Omit<Diagnostics, "languages"> & Partial<Pick<Diagnostics, "languages">>): string {
  const langs = Object.entries(d.languages ?? {});
  const perLanguage = langs.length > 1 ? ` (${langs.map(([id, l]) => `${id} ${l.filesScanned}`).join(", ")})` : "";
  const parts = [`scanned ${d.filesScanned}/${d.filesSeen} files${perLanguage}`];
  const skipped = Object.values(d.skippedCounts).reduce((a, b) => a + b, 0);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  const limits = d.unfollowed.filter((u) => u.reason === "graphql-limit").length;
  const tables = d.unfollowed.filter((u) => u.reason === "host-table-limit").length;
  const unfollowed = d.unfollowed.length - limits - tables;
  if (unfollowed > 0) parts.push(`${plural(unfollowed, "call", "calls")} not followed`);
  if (limits > 0) parts.push(`${plural(limits, "GraphQL document", "GraphQL documents")} not fully read`);
  if (tables > 0) parts.push(`${plural(tables, "host table", "host tables")} too large to list`);
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

/** `hosts named in code: 42, explained by a call: 37; not explained: api.acme.com (3 files), ...` (the first five). */
export function hostsLine(h: HostCoverage): string {
  const line = `hosts named in code: ${h.named}, explained by a call: ${h.explained}`;
  const shown = h.unexplained.slice(0, 5).map((u) => `${u.host} (${plural(u.files, "file", "files")})`);
  const more = h.named - h.explained - shown.length;
  return shown.length === 0 ? line : `${line}; not explained: ${shown.join(", ")}${more > 0 ? `, +${more}` : ""}`;
}

/** The table's line for `coverage.mcpToolRefs`; undefined when no file pins a tool name. */
export function mcpToolRefsLine(r: McpToolRefs): string | undefined {
  if (r.files === 0) return undefined;
  const line = `MCP tool names pinned in ${plural(r.files, "file", "files")}: ${plural(r.pairs, "tool", "tools")}, ${plural(r.references, "reference", "references")}`;
  const shown = r.tools.slice(0, 3).map((t) => `mcp__${t.server}__${t.tool} (${t.references})`);
  return shown.length === 0 ? line : `${line}; most: ${shown.join(", ")}`;
}
