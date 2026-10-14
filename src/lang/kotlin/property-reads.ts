import { JVM_REGISTRY } from "../jvm/registry/index.js";

/**
 * Kotlin properties a JVM registry reads as requests (Firebase Storage's `ref.downloadUrl`, the getter
 * `getDownloadUrl()` that fetches it): the lowering records reads of them as calls without arguments, which match
 * those registry entries only.
 */
export const KOTLIN_PROPERTY_READS: ReadonlySet<string> = new Set(
  JVM_REGISTRY.flatMap((r) => Object.entries(r.methods).flatMap(([key, spec]) => (spec.property ? [key.split(".").at(-1)!] : []))),
);
