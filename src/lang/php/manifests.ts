import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Manifests } from "../ir/language.js";

/** Composer package names are case-insensitive. */
export function normalizeComposer(name: string): string {
  return name.toLowerCase();
}

type Deps = Map<string, string>;

/** `require` of a composer.json (platform packages such as `php` and `ext-*` aside). */
function depsOf(dir: string): Deps {
  const deps: Deps = new Map();
  const file = path.join(dir, "composer.json");
  if (!existsSync(file)) return deps;
  try {
    const json = JSON.parse(readFileSync(file, "utf8")) as { require?: Record<string, string> };
    for (const [name, version] of Object.entries(json.require ?? {})) if (name.includes("/")) deps.set(normalizeComposer(name), version);
  } catch {
    // an unreadable composer.json declares nothing
  }
  return deps;
}

/** PHP manifests: composer.json. */
export function phpManifests(): Manifests {
  const cache = new Map<string, Deps>();
  const cached = (dir: string): Deps => {
    let d = cache.get(dir);
    if (!d) {
      d = depsOf(dir);
      cache.set(dir, d);
    }
    return d;
  };
  return {
    declared: (dirs) => new Set([...dirs].flatMap((d) => [...cached(d).keys()])),
    version: (file, pkg, rootDir) => {
      const name = normalizeComposer(pkg);
      for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
        const v = cached(dir).get(name);
        if (v) return v;
        if (dir === rootDir || !dir.startsWith(rootDir) || path.dirname(dir) === dir) return undefined;
      }
    },
  };
}
