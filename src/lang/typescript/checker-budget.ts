import type { Project } from "ts-morph";

/**
 * Types a checker may make before it is dropped. A count, not the heap: the same repository must give the same report
 * whatever the heap, the machine or the garbage collector, and the checker makes the same types in the same order on
 * every run, so it is dropped at the same files.
 */
export const MAX_TYPES = Number(process.env.T68 ?? 400_000);
export const MAX_INSTANTIATIONS = Number(process.env.I68 ?? 3_000_000);

interface WithContext {
  _context?: { resetProgram?: () => void };
}

/**
 * Starts a new program and checker for `project`, keeping its syntax trees and their bindings: the types the old
 * checker made (most of a large project's heap) can then be collected, and the new one makes again those it is asked
 * for. ts-morph does this itself when a file is added or removed; `resetProgram` is that step, not public.
 */
export function resetChecker(project: Project): boolean {
  const context = (project as unknown as WithContext)._context;
  if (typeof context?.resetProgram !== "function") return false;
  context.resetProgram();
  return true;
}

let resets = 0;
/**
 * Called between two files or two calls of one project (#68): drops the checker once it has made `MAX_TYPES` types.
 * Files that see each other share a project however large they are (a backend whose modules all import each other), so
 * this is what bounds its heap.
 */
export function relieve(project: Project): void {
  const program = project.getProgram().compilerObject;
  if (program.getTypeCount() < MAX_TYPES && program.getInstantiationCount() < MAX_INSTANTIATIONS) return;
  if (process.env.DEBUG68) process.stderr.write(`RESET ${++resets} t=${Math.round(performance.now())}\n`);
  resetChecker(project);
}
