import path from "node:path";
import { isInside, readConfigFile } from "../../files.js";
import type { Manifests } from "../ir/language.js";

/** pub.dev names are lower case with underscores. */
export function normalizePub(name: string): string {
  return name.trim().toLowerCase();
}

type Deps = Map<string, string>;

const unquote = (s: string): string => s.trim().replace(/^(["'])(.*)\1$/, "$2");

/**
 * The `dependencies:` of a `pubspec.yaml`, with their versions: `http: ^1.2.0`, or a map whose `version:` gives it (a
 * `git:`, `path:` or `sdk:` dependency has none). Dev dependencies and overrides are not the app's. The file is read
 * line by line: keys at the block's first indentation are packages.
 */
export function parsePubspec(text: string): Deps {
  const deps: Deps = new Map();
  let inDeps = false;
  let indent = -1;
  let current: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const depth = line.length - line.trimStart().length;
    if (depth === 0) {
      inDeps = /^dependencies\s*:\s*$/.test(line);
      indent = -1;
      continue;
    }
    if (!inDeps) continue;
    if (indent < 0) indent = depth;
    const m = /^\s*([A-Za-z_][\w]*)\s*:\s*(.*)$/.exec(line);
    if (depth === indent && m) {
      current = normalizePub(m[1]!);
      const v = unquote(m[2] ?? "");
      deps.set(current, v === "any" ? "" : v);
    } else if (depth > indent && m && m[1] === "version" && current) deps.set(current, unquote(m[2] ?? ""));
  }
  return deps;
}

/** Pub manifests: the `pubspec.yaml` of a directory, the nearest one above a file for its versions. */
export function pubManifests(): Manifests {
  const cache = new Map<string, Deps>();
  const cached = (dir: string, rootDir: string): Deps => {
    const key = `${rootDir}\0${dir}`;
    let d = cache.get(key);
    if (!d) {
      const text = readConfigFile(path.join(dir, "pubspec.yaml"), rootDir);
      d = text === undefined ? new Map<string, string>() : parsePubspec(text);
      cache.set(key, d);
    }
    return d;
  };
  return {
    declared: (dirs, rootDir) => new Set([...dirs].flatMap((d) => [...cached(d, rootDir).keys()])),
    version: (file, pkg, rootDir) => {
      const name = normalizePub(pkg);
      for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
        const v = cached(dir, rootDir).get(name);
        if (v) return v;
        if (dir === rootDir || !isInside(rootDir, dir) || path.dirname(dir) === dir) return undefined;
      }
    },
  };
}
