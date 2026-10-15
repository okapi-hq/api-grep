import path from "node:path";
import { isInside, readConfigFile } from "../../files.js";
import type { Manifests } from "../ir/language.js";

/** Go module paths are case-sensitive and written one way: nothing to normalize. */
export function normalizeGoModule(name: string): string {
  return name.trim();
}

type Deps = Map<string, string>;

/**
 * The `require` directives of a `go.mod` (single and block form), with their versions; `// indirect` requirements are
 * the dependencies' own, not the module's.
 */
export function parseGoMod(text: string): Deps {
  const deps: Deps = new Map();
  let block = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (block && line.startsWith(")")) {
      block = false;
      continue;
    }
    if (/^require\s*\($/.test(line)) {
      block = true;
      continue;
    }
    const spec = block ? line : /^require\s+(.+)$/.exec(line)?.[1];
    if (!spec || spec.startsWith("//") || /\/\/\s*indirect\b/.test(spec)) continue;
    const m = /^"?([^\s"]+)"?\s+(\S+)/.exec(spec);
    if (m) deps.set(normalizeGoModule(m[1]!), m[2]!);
  }
  return deps;
}

/** Go manifests: `go.mod`. */
export function goManifests(): Manifests {
  const cache = new Map<string, Deps>();
  const cached = (dir: string, rootDir: string): Deps => {
    const key = `${rootDir}\0${dir}`;
    let d = cache.get(key);
    if (!d) {
      const text = readConfigFile(path.join(dir, "go.mod"), rootDir);
      d = text === undefined ? new Map() : parseGoMod(text);
      cache.set(key, d);
    }
    return d;
  };
  return {
    declared: (dirs, rootDir) => new Set([...dirs].flatMap((d) => [...cached(d, rootDir).keys()])),
    version: (file, pkg, rootDir) => {
      const name = normalizeGoModule(pkg);
      for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
        const v = cached(dir, rootDir).get(name);
        if (v) return v;
        if (dir === rootDir || !isInside(rootDir, dir) || path.dirname(dir) === dir) return undefined;
      }
    },
  };
}
