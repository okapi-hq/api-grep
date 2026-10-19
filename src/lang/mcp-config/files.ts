import path from "node:path";
import fg from "fast-glob";
import { isInside, realPath, relativePosix } from "../../files.js";
import { globMatcher, SHARED_EXCLUDES, type FileSelection, type LeftOut } from "../files.js";

/**
 * The files coding agents and editors declare their MCP servers in: `.mcp.json` (Claude Code), `mcp.json` (Cursor's
 * `.cursor/`, VS Code's `.vscode/`, Roo's `.roo/`, Kiro's `.kiro/settings/`, Amazon Q's `.amazonq/`),
 * `claude_desktop_config.json`, `mcp_config.json` (Windsurf), `cline_mcp_settings.json`, `.gemini/settings.json`,
 * `opencode.json(c)`, `.codex/config.toml` and `.zed/settings.json`. Most live in dot directories: those are read.
 */

/** File names read wherever they are. */
const NAMES = new Set([".mcp.json", "mcp.json", "claude_desktop_config.json", "mcp_config.json", "cline_mcp_settings.json", "opencode.json", "opencode.jsonc"]);

/** File names read only in the directory of their tool (`settings.json` is every editor's). */
const IN_DIRECTORY: Record<string, string> = { "settings.json": "", "config.toml": ".codex" };
const SETTINGS_DIRS = new Set([".gemini", ".zed"]);

const PATTERNS = [...[...NAMES].map((n) => `**/${n}`), "**/.gemini/settings.json", "**/.zed/settings.json", "**/.codex/config.toml"];

/** A configuration file of the default set, by its name and the directory it is in. */
export function isMcpConfigFile(file: string): boolean {
  const name = path.basename(file);
  if (NAMES.has(name)) return true;
  if (!Object.hasOwn(IN_DIRECTORY, name)) return false;
  const dir = path.basename(path.dirname(file));
  return IN_DIRECTORY[name] ? dir === IN_DIRECTORY[name] : SETTINGS_DIRS.has(dir);
}

/** The configuration files under `dir`: the `--include` globs or the default set, minus the excludes, kept inside `dir`. */
export function mcpConfigFiles(dir: string, include: string[] | undefined, exclude: string[]): string[] {
  const patterns = include && include.length > 0 ? include : PATTERNS;
  const realDir = realPath(dir);
  return fg
    .sync(patterns, { cwd: dir, absolute: true, ignore: exclude, dot: true, followSymbolicLinks: false, onlyFiles: true })
    .filter(isMcpConfigFile)
    .filter((f) => isInside(realDir, realPath(f)))
    .sort();
}

/** Files the default set would read but --exclude / --include removed. */
export function mcpConfigLeftOut(sel: FileSelection, kept: Set<string>): LeftOut[] {
  if (!sel.include?.length && !sel.exclude?.length) return [];
  const excluded = globMatcher(sel.dir, sel.exclude);
  return mcpConfigFiles(sel.dir, undefined, SHARED_EXCLUDES)
    .filter((f) => !kept.has(f))
    .map((f) => ({ file: relativePosix(sel.dir, f), reason: excluded?.(f) ? "excluded" : "not-included" }));
}
