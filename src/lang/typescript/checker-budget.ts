import type { Project } from "ts-morph";

/**
 * What a checker may make before it is dropped: counts, not the heap. A new checker can type a few expressions
 * differently (TypeScript's inference depends on the order it meets types), so the report must not depend on the heap,
 * the machine or the garbage collector: a checker makes the same types in the same order on every run, so it is
 * dropped after the same files. Instantiations are what fill the heap in a backend of generic types (about 1.5 KB
 * each in infisical's); a checker reaching either count holds 300 to 500 MB.
 */
export const MAX_TYPES = 400_000;
export const MAX_INSTANTIATIONS = 3_000_000;

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
 * Called between two files or two calls of one project (#68): drops the checker once it has made `MAX_TYPES` types or
 * `MAX_INSTANTIATIONS` instantiations. Files that see each other share a project however large they are (a backend
 * whose modules all import each other), so this is what bounds its heap. Returns whether it did.
 */
export function relieve(project: Project, limits = { types: MAX_TYPES, instantiations: MAX_INSTANTIATIONS }): boolean {
  const program = project.getProgram().compilerObject;
  if (program.getTypeCount() < limits.types && program.getInstantiationCount() < limits.instantiations) return false;
  return resetChecker(project);
}
