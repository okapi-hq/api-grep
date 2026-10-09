import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { SourceFile } from "ts-morph";

const run = promisify(execFile);

/**
 * A scanned directory is not trusted: its `.git/config` could name a program for git to run while it refreshes the
 * index (`core.fsmonitor`), diffs (`diff.external`, textconv drivers) or fetches a missing object from a promisor
 * remote (`uploadpack`). The monitor is switched off, transports are refused (`protocol.allow`, no lazy fetch), a bare
 * repository is only opened when named (`safe.bareRepository`), and `diff` runs with `--no-ext-diff --no-textconv`.
 */
const SAFE_CONFIG = ["-c", "core.fsmonitor=false", "-c", "protocol.allow=never", "-c", "safe.bareRepository=explicit"];

async function git(dir: string, args: string[]): Promise<string> {
  if (process.env.API_GREP_NO_GIT) throw new Error("git is off (API_GREP_NO_GIT)");
  const env = { ...process.env, GIT_NO_LAZY_FETCH: "1" };
  const { stdout } = await run("git", [...SAFE_CONFIG, ...args], { cwd: dir, env, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });
  return stdout;
}

async function verifyCommit(dir: string, ref: string): Promise<string> {
  if (!ref || ref.startsWith("-") || /[\0\n\r]/.test(ref)) throw new Error(`invalid git ref: ${JSON.stringify(ref)}`);
  try {
    return (await git(dir, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).trim();
  } catch {
    throw new Error(`unknown git ref: ${ref}`);
  }
}

/**
 * What `git diff` compares the working tree (or, for a range, the second commit) to: a ref given on the command line,
 * never an option (`--output=...`). `origin/main...HEAD` keeps its range meaning, each side checked on its own.
 */
async function diffBase(dir: string, ref: string): Promise<string> {
  const range = /^(.+?)(\.\.\.?)(.+)$/.exec(ref);
  if (!range) return verifyCommit(dir, ref);
  const [, from, dots, to] = range;
  return `${await verifyCommit(dir, from!)}${dots}${await verifyCommit(dir, to!)}`;
}

/** Files changed since `ref` (committed, staged or not) plus untracked ones, as absolute paths. */
export async function changedFiles(dir: string, ref: string): Promise<Set<string>> {
  const base = await diffBase(dir, ref);
  const root = (await git(dir, ["rev-parse", "--show-toplevel"])).trim();
  const out = await git(dir, ["diff", "--name-only", "--no-ext-diff", "--no-textconv", base, "--"]);
  // diff names files from the top of the repository; ls-files does with --full-name
  const untracked = await git(dir, ["ls-files", "--others", "--exclude-standard", "--full-name"]);
  const files = new Set<string>();
  for (const line of `${out}\n${untracked}`.split("\n")) {
    const f = line.trim();
    if (f) files.add(path.resolve(root, f));
  }
  return files;
}

export async function headCommit(dir: string): Promise<string | undefined> {
  try {
    return (await git(dir, ["rev-parse", "--verify", "--quiet", "HEAD"])).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Changed files plus files importing them (one hop). */
export function selectChanged(files: SourceFile[], changed: Set<string>): SourceFile[] {
  const inScope = new Set(files);
  const keep = new Set<SourceFile>(files.filter((sf) => changed.has(sf.getFilePath())));
  for (const sf of [...keep]) for (const ref of sf.getReferencingSourceFiles()) if (inScope.has(ref)) keep.add(ref);
  return files.filter((sf) => keep.has(sf));
}
