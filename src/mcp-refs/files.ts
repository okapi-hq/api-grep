import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { isInside, realPath } from "../files.js";
import { CODE_EXTENSIONS } from "./kinds.js";

/**
 * The text files read for pinned MCP tool names: documents, configuration and CI files, and code. Hostile input:
 * symlinks must stay inside the scanned directory, only regular files of a bounded size are read, and a scan reads a
 * bounded number of them.
 */

const TEXT_EXTENSIONS = [".md", ".mdx", ".mdc", ".markdown", ".txt", ".json", ".jsonc", ".json5", ".yml", ".yaml", ".toml", ...CODE_EXTENSIONS];

/** Extension-less instruction files of coding agents. */
const TEXT_NAMES = new Set([".cursorrules", ".windsurfrules", ".clinerules"]);

/** Beyond the shared excludes: vendored dependencies, build output and generated files no one pins a tool name in. */
const GENERATED = [
  ...["vendor", "bower_components", ".venv", "venv", "site-packages", ".tox", "target", ".next", ".nuxt", ".output", ".svelte-kit", "coverage", "storybook-static"].map((d) => `**/${d}/**`),
  ...["*.min.js", "*.bundle.js", "*.chunk.js", "package-lock.json", "pnpm-lock.yaml", "npm-shrinkwrap.json"].map((f) => `**/${f}`),
];

const PATTERNS = [`**/*.{${TEXT_EXTENSIONS.map((e) => e.slice(1)).join(",")}}`, ...[...TEXT_NAMES].map((n) => `**/${n}`)];

/** Bytes of a file read at most: a larger one (a bundle, a data dump) is no place tool names are pinned. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Files read at most per scan. */
export const MAX_FILES = 100_000;

export const isTextFile = (file: string): boolean => {
  const name = path.basename(file);
  return TEXT_NAMES.has(name) || TEXT_EXTENSIONS.some((e) => name.endsWith(e));
};

/** The text files under `dir`: the `--include` globs or the default set, minus the excludes, kept inside `dir`, sorted. */
export function textFiles(dir: string, include: string[] | undefined, exclude: string[]): string[] {
  const patterns = include && include.length > 0 ? include : PATTERNS;
  const realDir = realPath(dir);
  return fg
    .sync(patterns, { cwd: dir, absolute: true, ignore: [...exclude, ...GENERATED], dot: true, followSymbolicLinks: false, onlyFiles: true })
    .filter(isTextFile)
    .filter((f) => isInside(realDir, realPath(f)))
    .sort()
    .slice(0, MAX_FILES);
}

/** A regular file of at most `MAX_FILE_BYTES`, as text; undefined otherwise or when it cannot be read. */
export function readText(file: string): string | undefined {
  try {
    const st = statSync(file, { throwIfNoEntry: false });
    return st?.isFile() && st.size <= MAX_FILE_BYTES ? readFileSync(file, "utf8") : undefined;
  } catch {
    return undefined;
  }
}
