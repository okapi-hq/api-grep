import { existsSync } from "node:fs";
import path from "node:path";
import { isConfigFile } from "./files.js";

/** The tsconfig a scan reads, and the directory it and what it extends must stay in (undefined: anywhere). */
export interface TsconfigChoice {
  file?: string;
  bound?: string;
}

/**
 * The root of the git repository holding `dir`: the nearest directory with a `.git` entry (a directory, or a file in
 * a worktree or submodule), `dir` included.
 */
export function repositoryRoot(dir: string): string | undefined {
  for (let cur = path.resolve(dir); ; cur = path.dirname(cur)) {
    if (existsSync(path.join(cur, ".git"))) return cur;
    if (path.dirname(cur) === cur) return undefined;
  }
}

/**
 * What a TypeScript scan of `dir` may read (#112): its repository, so a subdirectory of a monorepo still reads the
 * sibling packages and wrappers it imports, and nothing above it, so the report does not depend on where the repository
 * was cloned. Outside any repository (an archive the server unpacked), `dir` only.
 */
export function readRoot(dir: string): string {
  return repositoryRoot(dir) ?? path.resolve(dir);
}

/**
 * The nearest tsconfig.json, or jsconfig.json for a JavaScript project (path aliases live there too): in `dir` or up to
 * four directories above, never above `readRoot(dir)` (#112). A tsconfig above the checkout (the scanning tool's own, a
 * stray one in a home directory) would make a report depend on where the repository was cloned. The tsconfig and what
 * it extends are read inside that same bound.
 */
export function findTsconfig(dir: string): TsconfigChoice {
  let cur = path.resolve(dir);
  const top = readRoot(cur);
  for (let i = 0; i < 5; i++) {
    const file = ["tsconfig.json", "jsconfig.json"].map((name) => path.join(cur, name)).find(isConfigFile);
    if (file) return { file, bound: top };
    if (cur === top || path.dirname(cur) === cur) break;
    cur = path.dirname(cur);
  }
  return { bound: top };
}

/** `--tsconfig` is read wherever it is: the user named it. */
export function tsconfigFor(dir: string, explicit: string | undefined): TsconfigChoice {
  if (!explicit) return findTsconfig(dir);
  const file = path.resolve(explicit);
  if (!isConfigFile(file)) throw new Error(`tsconfig not found: ${file}`);
  return { file };
}
