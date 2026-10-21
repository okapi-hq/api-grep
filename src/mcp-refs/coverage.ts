import { relativePosix } from "../files.js";
import { SHARED_EXCLUDES } from "../lang/files.js";
import type { McpServerRef, McpToolRef, McpToolRefs, ToolRefKind } from "../report/schema.js";
import { declaredServers, type DeclaredServers } from "./declared.js";
import { readText, textFiles } from "./files.js";
import { fileKind, KIND_ORDER } from "./kinds.js";
import { toolNamesIn } from "./names.js";

/**
 * `coverage.mcpToolRefs`: the MCP tool names the repository's text files pin by the `mcp__<server>__<tool>`
 * convention, per (server, tool), with the kinds of files they are in and whether the server is declared.
 */

/** Tools and servers listed in a report; `pairs` still counts every tool. */
export const MAX_LISTED = 200;

/** References counted at most per scan: a bound on hostile input. */
export const MAX_REFERENCES = 50_000;

interface Tally {
  server: string;
  tool?: string;
  references: number;
  files: Set<string>;
  kinds: Set<ToolRefKind>;
}

export interface ToolRefSelection {
  include?: string[];
  exclude?: string[];
}

/** Counts each name of each file; returns the files with any. */
function tallyFiles(rootDir: string, files: string[], tallies: Map<string, Tally>): number {
  let withRefs = 0;
  let counted = 0;
  for (const file of files) {
    const text = readText(file);
    const names = text === undefined ? [] : toolNamesIn(text);
    if (names.length === 0) continue;
    withRefs++;
    const rel = relativePosix(rootDir, file);
    const kind = fileKind(rel);
    for (const n of names) {
      if (++counted > MAX_REFERENCES) return withRefs;
      const key = n.tool === undefined ? n.server : `${n.server}__${n.tool}`;
      const t = tallies.get(key) ?? { server: n.server, ...(n.tool !== undefined ? { tool: n.tool } : {}), references: 0, files: new Set(), kinds: new Set() };
      t.references++;
      t.files.add(rel);
      t.kinds.add(kind);
      tallies.set(key, t);
    }
  }
  return withRefs;
}

/** A row's counts and declaration, after its `server` (and `tool`). */
function rowOf(t: Tally, declared: DeclaredServers): Omit<McpServerRef, "server"> {
  const host = declared.get(t.server);
  return {
    references: t.references,
    files: t.files.size,
    kinds: KIND_ORDER.filter((k) => t.kinds.has(k)),
    declared: declared.has(t.server),
    ...(host ? { host } : {}),
  };
}

const byReferences = (a: Tally, b: Tally): number =>
  b.references - a.references || (a.server < b.server ? -1 : a.server > b.server ? 1 : 0) || ((a.tool ?? "") < (b.tool ?? "") ? -1 : (a.tool ?? "") > (b.tool ?? "") ? 1 : 0);

/** The pinned tool names of the text files under `rootDir` the selection keeps (shared excludes too). */
export function mcpToolRefs(rootDir: string, sel: ToolRefSelection = {}): McpToolRefs {
  const exclude = [...SHARED_EXCLUDES, ...(sel.exclude ?? [])];
  const tallies = new Map<string, Tally>();
  const files = tallyFiles(rootDir, textFiles(rootDir, sel.include, exclude), tallies);
  const all = [...tallies.values()].sort(byReferences);
  const tools = all.filter((t) => t.tool !== undefined);
  const declared = tallies.size > 0 ? declaredServers(rootDir, sel.include, exclude) : new Map<string, string | undefined>();
  return {
    files,
    references: tools.reduce((n, t) => n + t.references, 0),
    pairs: tools.length,
    tools: tools.slice(0, MAX_LISTED).map((t): McpToolRef => ({ server: t.server, tool: t.tool!, ...rowOf(t, declared) })),
    servers: all
      .filter((t) => t.tool === undefined)
      .slice(0, MAX_LISTED)
      .map((t): McpServerRef => ({ server: t.server, ...rowOf(t, declared) })),
  };
}
