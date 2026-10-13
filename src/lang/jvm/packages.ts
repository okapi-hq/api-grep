import { normalizeMaven } from "./manifests.js";
import packages from "./packages.json" with { type: "json" };

const ROOTS: Record<string, string[]> = packages.packages;
const DECLARED_ONLY: Record<string, string[]> = packages.declaredOnly;

/**
 * Java and Kotlin package roots a Maven artifact is imported from: a known exception, else its group id. Roots it
 * shares with artifacts that are not SDKs (firebase-admin's `com.google.firebase`, Android Firebase's too) count only
 * where the manifests declare it.
 */
export function jvmImportRoots(pkg: string, declared = false): string[] {
  const key = normalizeMaven(pkg);
  const own = Object.hasOwn(ROOTS, key) ? ROOTS[key]! : [key.split(":")[0]!];
  return declared && Object.hasOwn(DECLARED_ONLY, key) ? [...own, ...DECLARED_ONLY[key]!] : own;
}
