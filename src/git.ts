import path from "node:path";
import { simpleGit } from "simple-git";
import type { SourceFile } from "ts-morph";

export async function changedFiles(dir: string, ref: string): Promise<Set<string>> {
  const git = simpleGit(dir);
  const root = (await git.revparse(["--show-toplevel"])).trim();
  const out = await git.diff(["--name-only", ref, "--"]);
  const untracked = await git.raw(["ls-files", "--others", "--exclude-standard"]);
  const files = new Set<string>();
  for (const line of `${out}\n${untracked}`.split("\n")) {
    const f = line.trim();
    if (f) files.add(path.resolve(root, f));
  }
  return files;
}

export async function headCommit(dir: string): Promise<string | undefined> {
  try {
    return (await simpleGit(dir).revparse(["HEAD"])).trim();
  } catch {
    return undefined;
  }
}

/** Changed files plus files importing them (one hop). */
export function selectChanged(files: SourceFile[], changed: Set<string>): SourceFile[] {
  const direct = files.filter((sf) => changed.has(sf.getFilePath()));
  const keep = new Set<SourceFile>(direct);
  for (const sf of direct) for (const ref of sf.getReferencingSourceFiles()) if (files.includes(ref)) keep.add(ref);
  return files.filter((sf) => keep.has(sf));
}
