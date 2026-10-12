import { normalizeMaven } from "./manifests.js";
import packages from "./packages.json" with { type: "json" };

const ROOTS: Record<string, string[]> = packages.packages;

/** Java and Kotlin package roots a Maven artifact is imported from: a known exception, else its group id. */
export function jvmImportRoots(pkg: string): string[] {
  const key = normalizeMaven(pkg);
  return Object.hasOwn(ROOTS, key) ? ROOTS[key]! : [key.split(":")[0]!];
}
