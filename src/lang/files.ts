import path from "node:path";
import fg from "fast-glob";
import picomatch from "picomatch";
import { isInside, readConfigFile, realPath, relativePosix } from "../files.js";

/** Out of scope for every language: dependencies, build output and VCS metadata. */
export const SHARED_EXCLUDES = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"];

export interface FileSelection {
  dir: string;
  include?: string[];
  exclude?: string[];
}

export interface LeftOut {
  file: string;
  reason: "excluded" | "not-included";
}

export function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0]!;
}

export type Matcher = (file: string) => boolean;

/** Matches absolute paths under `dir` against globs relative to it; compiled once, same engine family as fast-glob. */
export function globMatcher(dir: string, globs: string[] | undefined): Matcher | undefined {
  if (!globs || globs.length === 0) return undefined;
  const isMatch = picomatch(globs, { dot: true });
  return (file) => isMatch(relativePosix(dir, file));
}

const hasExtension = (extensions: string[]) => (file: string) => extensions.some((e) => file.endsWith(e));

/**
 * Files of one language: the `--include` globs (or every file with its extensions), minus the excludes. Only files
 * still under `dir` once symlinks are resolved: a committed symlink cannot pull in a file from elsewhere on disk.
 */
export function languageFiles(dir: string, extensions: string[], include: string[] | undefined, exclude: string[]): string[] {
  const patterns = include && include.length > 0 ? include : extensions.map((e) => `**/*${e}`);
  const realDir = realPath(dir);
  return fg
    .sync(patterns, { cwd: dir, absolute: true, ignore: exclude, followSymbolicLinks: false })
    .filter(hasExtension(extensions))
    .filter((f) => isInside(realDir, realPath(f)));
}

/**
 * Files the default file set would scan but --exclude / --include removed; test files and build output are out of
 * scope, and `kept` holds the files scanned or already reported (unreadable).
 */
export function leftOutFiles(sel: FileSelection, extensions: string[], defaultExcludes: string[], kept: Set<string>): LeftOut[] {
  if (!sel.include?.length && !sel.exclude?.length) return [];
  const excluded = globMatcher(sel.dir, sel.exclude);
  return languageFiles(sel.dir, extensions, undefined, defaultExcludes)
    .filter((f) => !kept.has(f))
    .map((f) => ({ file: relativePosix(sel.dir, f), reason: excluded?.(f) ? "excluded" : "not-included" }));
}

/** Reads .env.example / .env.sample for host hints (values are only used if they look like URLs). */
export function readEnvHints(dir: string): Record<string, string> {
  const hints: Record<string, string> = {};
  for (const name of [".env.example", ".env.sample", ".env.template", ".env.dist"]) {
    const text = readConfigFile(path.join(dir, name), dir);
    if (text === undefined) continue;
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*["']?([^"'#\s]*)/.exec(line);
      if (m && m[2] && /^https?:\/\//.test(m[2])) hints[m[1]!] = m[2];
    }
  }
  return hints;
}
