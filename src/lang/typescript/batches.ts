import { statSync } from "node:fs";
import { Project } from "ts-morph";

/**
 * Source text per checker project. A project holds every syntax tree and binding of its files until it is dropped,
 * and its checker's types until `checker-budget.ts` drops them: 16 MB of source fits in a 1.5 GB heap (#68). A
 * repository with less is scanned in one project, as it always was.
 */
export const BATCH_BYTES = 16_000_000;

export function sizeOf(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * Groups of files packed into batches of about `budget` bytes of source, each batch in file order. A group is never
 * split: its files see each other. With `changed`, only the groups holding a changed file are scanned.
 */
export function packBatches(files: string[], groups: number[][], budget = BATCH_BYTES, changed?: Set<string>): string[][] {
  const batches: number[][] = [];
  let current: number[] = [];
  let bytes = 0;
  for (const group of groups) {
    if (changed && !group.some((i) => changed.has(files[i]!))) continue;
    const size = group.reduce((a, i) => a + sizeOf(files[i]!), 0);
    // a group over the budget is a batch of its own: the small ones around it still share theirs
    if (size >= budget) {
      batches.push([...group]);
      continue;
    }
    if (current.length > 0 && bytes + size > budget) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(...group);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches.map((b) => b.sort((x, y) => x - y).map((i) => files[i]!));
}

/**
 * The order a single project lists these files in (ts-morph sorts them by directory depth, then by name): the order a
 * scan reads them, its diagnostics and calls come in, whatever the batches. Files are added in the given order.
 */
export function projectOrder(files: string[]): Map<string, number> {
  const project = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
  for (const f of files) project.createSourceFile(f, "", { overwrite: true });
  return new Map(project.getSourceFiles().map((sf, i) => [sf.getFilePath() as string, i]));
}
