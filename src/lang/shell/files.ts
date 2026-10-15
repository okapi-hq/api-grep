import { closeSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { isInside, realPath, relativePosix } from "../../files.js";
import { globMatcher, SHARED_EXCLUDES, type FileSelection, type LeftOut } from "../files.js";

export const SHELL_EXTENSIONS = [".sh", ".bash", ".zsh"];

export const SHELL_EXCLUDES = [
  ...SHARED_EXCLUDES,
  "**/vendor/**",
  "**/tests/**",
  "**/test/**",
  "**/testdata/**",
  "**/__tests__/**",
  "**/*_test.sh",
  "**/test_*.sh",
  "**/*.test.sh",
  // virtualenvs carry `bin/activate`; the Maven and Gradle wrappers are generated scripts that download themselves
  "**/.venv/**",
  "**/venv/**",
  "**/site-packages/**",
  "**/.tox/**",
  "**/mvnw",
  "**/gradlew",
];

/** `#!/bin/sh`, `#!/bin/bash`, `#!/usr/bin/env bash`, `#!/usr/bin/env -S zsh -e`, `#!/bin/dash`. */
const SHEBANG = /^#![ \t]*\S*\/(?:env[ \t]+(?:-\S+[ \t]+)*)?(?:ba|z|da)?sh(?:[ \t]|$)/;

/** A regular file of no extension whose first line is a shell `#!` line; only its first bytes are read. */
function hasShellShebang(file: string): boolean {
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) return false;
  const buf = Buffer.alloc(128);
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const n = readSync(fd, buf, 0, buf.length, 0);
    return SHEBANG.test(buf.subarray(0, n).toString("latin1").split("\n")[0]!);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const hasNoExtension = (file: string): boolean => !path.basename(file).includes(".");

/** A shell script by its extension, or by its `#!` line when it has none (`bin/deploy`, `scripts/notify`). */
export function isShellFile(file: string): boolean {
  if (SHELL_EXTENSIONS.some((e) => file.endsWith(e))) return true;
  return hasNoExtension(file) && hasShellShebang(file);
}

/**
 * Shell scripts under `dir`: the `--include` globs (or every `.sh` / `.bash` / `.zsh` file and every file with no
 * extension), minus the excludes, kept when they are shell scripts and still under `dir` once symlinks are resolved.
 */
export function shellFiles(dir: string, include: string[] | undefined, exclude: string[]): string[] {
  const patterns = include && include.length > 0 ? include : [...SHELL_EXTENSIONS.map((e) => `**/*${e}`), "**/!(*.*)"];
  const realDir = realPath(dir);
  return fg
    .sync(patterns, { cwd: dir, absolute: true, ignore: exclude, followSymbolicLinks: false, onlyFiles: true })
    .filter((f) => isInside(realDir, realPath(f)))
    .filter(isShellFile);
}

/** Scripts the default file set would scan but --exclude / --include removed. */
export function shellLeftOut(sel: FileSelection, kept: Set<string>): LeftOut[] {
  if (!sel.include?.length && !sel.exclude?.length) return [];
  const excluded = globMatcher(sel.dir, sel.exclude);
  return shellFiles(sel.dir, undefined, SHELL_EXCLUDES)
    .filter((f) => !kept.has(f))
    .map((f) => ({ file: relativePosix(sel.dir, f), reason: excluded?.(f) ? "excluded" : "not-included" }));
}
