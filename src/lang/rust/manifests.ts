import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { isInside, readConfigFile } from "../../files.js";
import type { Manifests } from "../ir/language.js";

/** crates.io names are case-insensitive and treat `-` and `_` alike: written lower case with `-`. */
export function normalizeCrate(name: string): string {
  return name.trim().toLowerCase().replace(/_/g, "-");
}

type Deps = Map<string, string>;
type Table = Record<string, unknown>;

const isTable = (v: unknown): v is Table => typeof v === "object" && v !== null && !Array.isArray(v);

/** The tables of dependencies a crate builds with: `[dependencies]` and its per-target forms; not dev or build ones. */
function dependencyTables(toml: Table): Table[] {
  const out: Table[] = [];
  if (isTable(toml.dependencies)) out.push(toml.dependencies);
  if (isTable(toml.target)) for (const t of Object.values(toml.target)) if (isTable(t) && isTable(t.dependencies)) out.push(t.dependencies);
  return out;
}

/** A dependency's crate and version: `x = "1"`, `x = { version = "1" }`, `y = { package = "x", ... }`, `x.workspace = true`. */
function entry(key: string, spec: unknown, workspace: Deps): [string, string] | undefined {
  if (typeof spec === "string") return [normalizeCrate(key), spec];
  if (!isTable(spec)) return undefined;
  const name = normalizeCrate(typeof spec.package === "string" ? spec.package : key);
  if (typeof spec.version === "string") return [name, spec.version];
  if (spec.workspace === true) return [name, workspace.get(name) ?? ""];
  return [name, ""];
}

/** The workspace's `[workspace.dependencies]`, which members inherit with `x.workspace = true`. */
function workspaceDeps(toml: Table): Deps {
  const deps: Deps = new Map();
  const table = isTable(toml.workspace) && isTable(toml.workspace.dependencies) ? toml.workspace.dependencies : undefined;
  for (const [k, v] of Object.entries(table ?? {})) {
    const e = entry(k, v, new Map());
    if (e) deps.set(e[0], e[1]);
  }
  return deps;
}

/** The crates a `Cargo.toml` depends on, with their versions; a workspace's shared table counts as declared. */
export function parseCargoToml(text: string, workspace: Deps = new Map()): Deps {
  let toml: Table;
  try {
    toml = parseToml(text);
  } catch {
    return new Map();
  }
  const shared = workspaceDeps(toml);
  const deps: Deps = new Map(shared);
  for (const table of dependencyTables(toml)) {
    for (const [k, v] of Object.entries(table)) {
      const e = entry(k, v, shared.size > 0 ? shared : workspace);
      if (e) deps.set(e[0], e[1]);
    }
  }
  return deps;
}

/** Cargo manifests: `Cargo.toml`, a member's `x.workspace = true` read against the nearest workspace above it. */
export function cargoManifests(): Manifests {
  const cache = new Map<string, Deps>();
  const workspaceOf = (dir: string, rootDir: string): Deps => {
    for (let d = path.dirname(dir); isInside(rootDir, d); d = path.dirname(d)) {
      const text = readConfigFile(path.join(d, "Cargo.toml"), rootDir);
      if (text !== undefined && /^\s*\[workspace/m.test(text)) return parseCargoToml(text);
      if (d === rootDir || path.dirname(d) === d) break;
    }
    return new Map();
  };
  const cached = (dir: string, rootDir: string): Deps => {
    const key = `${rootDir}\0${dir}`;
    let d = cache.get(key);
    if (!d) {
      const text = readConfigFile(path.join(dir, "Cargo.toml"), rootDir);
      d = text === undefined ? new Map<string, string>() : parseCargoToml(text, /\bworkspace\s*=\s*true/.test(text) ? workspaceOf(dir, rootDir) : new Map<string, string>());
      cache.set(key, d);
    }
    return d;
  };
  return {
    declared: (dirs, rootDir) => new Set([...dirs].flatMap((d) => [...cached(d, rootDir).keys()])),
    version: (file, pkg, rootDir) => {
      const name = normalizeCrate(pkg);
      for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
        const v = cached(dir, rootDir).get(name);
        if (v) return v;
        if (dir === rootDir || !isInside(rootDir, dir) || path.dirname(dir) === dir) return undefined;
      }
    },
  };
}
