import path from "node:path";
import { readConfigFile } from "../../files.js";
import { buildConfigFields } from "./gradle.js";
import { upwards } from "./manifests.js";

/** `buildConfigField` literals per Gradle module directory; null for a directory without a build script. */
const cache = new Map<string, Map<string, string> | null>();

function fieldsIn(dir: string, rootDir: string): Map<string, string> | null {
  const key = `${rootDir}\0${dir}`;
  if (!cache.has(key)) {
    const text = ["build.gradle.kts", "build.gradle"].map((f) => readConfigFile(path.join(dir, f), rootDir)).find((t) => t !== undefined);
    cache.set(key, text === undefined ? null : buildConfigFields(text));
  }
  return cache.get(key)!;
}

/**
 * The literal an Android `BuildConfig.NAME` is given by the Gradle module a source file belongs to (its nearest build
 * script): `buildConfigField("String", "NAME", "\"https://...\"")`; undefined when it is not a literal.
 */
export function buildConfigValue(file: string, rootDir: string, name: string): string | undefined {
  for (const dir of upwards(path.dirname(file), rootDir)) {
    const fields = fieldsIn(dir, rootDir);
    if (fields) return fields.get(name);
  }
  return undefined;
}
