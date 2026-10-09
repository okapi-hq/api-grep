import path from "node:path";
import { isInside, readConfigFile } from "../../files.js";
import type { Manifests } from "../ir/language.js";

/** Composer package names are case-insensitive. */
export function normalizeComposer(name: string): string {
  return name.toLowerCase();
}

type Deps = Map<string, string>;

/** `require` of a composer.json (platform packages such as `php` and `ext-*` aside), read like other config files. */
function depsOf(dir: string, rootDir: string): Deps {
  const deps: Deps = new Map();
  const text = readConfigFile(path.join(dir, "composer.json"), rootDir);
  if (text === undefined) return deps;
  try {
    const json = JSON.parse(text) as { require?: Record<string, string> };
    for (const [name, version] of Object.entries(json.require ?? {})) if (name.includes("/")) deps.set(normalizeComposer(name), version);
  } catch {
    // an unreadable composer.json declares nothing
  }
  return deps;
}

/** PHP manifests: composer.json. */
export function phpManifests(): Manifests {
  const cache = new Map<string, Deps>();
  const cached = (dir: string, rootDir: string): Deps => {
    const key = `${rootDir}\0${dir}`;
    let d = cache.get(key);
    if (!d) {
      d = depsOf(dir, rootDir);
      cache.set(key, d);
    }
    return d;
  };
  return {
    declared: (dirs, rootDir) => new Set([...dirs].flatMap((d) => [...cached(d, rootDir).keys()])),
    version: (file, pkg, rootDir) => {
      const name = normalizeComposer(pkg);
      for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
        const v = cached(dir, rootDir).get(name);
        if (v) return v;
        if (dir === rootDir || !isInside(rootDir, dir) || path.dirname(dir) === dir) return undefined;
      }
    },
  };
}
