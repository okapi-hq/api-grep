import v8 from "node:v8";
import type { Project } from "ts-morph";

/** Share of the heap limit past which the checker's types are dropped. */
export const PRESSURE = 0.6;
/** Types the checker must have made since it was created before it is dropped: bounds the time spent remaking them. */
export const MIN_TYPES = 250_000;

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

/**
 * Called between two files or two calls of one project (#68): when the heap is filling up and the checker has made
 * many types, drops it. Files that see each other share a project however large they are (a backend whose modules all
 * import each other), so this is what bounds its heap. A project that fits in the heap never pays for this.
 */
export function relieve(project: Project): void {
  const { used_heap_size: used, heap_size_limit: limit } = v8.getHeapStatistics();
  if (used < limit * PRESSURE) return;
  if (project.getProgram().compilerObject.getTypeCount() < MIN_TYPES) return;
  resetChecker(project);
}
