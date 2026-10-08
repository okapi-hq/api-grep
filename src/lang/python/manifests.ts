import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import type { Manifests } from "../ir/language.js";

/** PEP 503: `Sentry_SDK` and `sentry.sdk` are `sentry-sdk`. */
export function normalizePypi(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

const REQ_RE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*([^;#\s][^;#]*)?/;

/** `requests[socks]>=2.31 ; python_version >= "3.8"` -> name and version spec. */
function parseRequirement(line: string): { name: string; spec?: string } | undefined {
  const t = line.trim();
  if (!t || t.startsWith("#") || t.startsWith("-") || /^[a-z+]+:\/\//i.test(t)) return undefined;
  const m = REQ_RE.exec(t);
  if (!m) return undefined;
  const spec = m[2]?.trim().replace(/\s+/g, "");
  return { name: normalizePypi(m[1]!), ...(spec ? { spec: spec.replace(/^==/, "") } : {}) };
}

function requirementFiles(dir: string): string[] {
  const out: string[] = [];
  const add = (d: string): void => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d)) if (/^requirements.*\.(?:txt|in)$/i.test(f) || (d !== dir && /\.txt$/i.test(f))) out.push(path.join(d, f));
  };
  add(dir);
  add(path.join(dir, "requirements"));
  return out;
}

type Deps = Map<string, string | undefined>;

function addReq(deps: Deps, line: string): void {
  const r = parseRequirement(line);
  if (r && !deps.has(r.name)) deps.set(r.name, r.spec);
}

function fromPyproject(file: string, deps: Deps): void {
  const toml = parseToml(readFileSync(file, "utf8")) as {
    project?: { dependencies?: string[] };
    tool?: { poetry?: { dependencies?: Record<string, unknown> } };
  };
  for (const d of toml.project?.dependencies ?? []) addReq(deps, d);
  for (const [name, v] of Object.entries(toml.tool?.poetry?.dependencies ?? {})) {
    if (name.toLowerCase() === "python") continue;
    const spec = typeof v === "string" ? v : typeof v === "object" && v && "version" in v ? String((v as { version: unknown }).version) : undefined;
    if (!deps.has(normalizePypi(name))) deps.set(normalizePypi(name), spec);
  }
}

function fromPipfile(file: string, deps: Deps): void {
  const toml = parseToml(readFileSync(file, "utf8")) as { packages?: Record<string, unknown> };
  for (const [name, v] of Object.entries(toml.packages ?? {})) {
    const spec = typeof v === "string" && v !== "*" ? v.replace(/^==/, "") : undefined;
    if (!deps.has(normalizePypi(name))) deps.set(normalizePypi(name), spec);
  }
}

/** `install_requires` of setup.cfg (an indented list) and setup.py (a list of string literals). */
function fromSetup(dir: string, deps: Deps): void {
  const cfg = path.join(dir, "setup.cfg");
  if (existsSync(cfg)) {
    const m = /install_requires\s*=\s*\n((?:[ \t]+.*\n?)*)/.exec(readFileSync(cfg, "utf8"));
    for (const line of m?.[1]?.split("\n") ?? []) addReq(deps, line);
  }
  const py = path.join(dir, "setup.py");
  if (existsSync(py)) {
    const m = /install_requires\s*=\s*\[([^\]]*)\]/.exec(readFileSync(py, "utf8"));
    for (const s of m?.[1]?.matchAll(/["']([^"']+)["']/g) ?? []) addReq(deps, s[1]!);
  }
}

/** Runtime dependencies declared in one directory, with their version specs; a manifest that does not parse declares nothing. */
function depsOf(dir: string): Deps {
  const deps: Deps = new Map();
  const read = (file: string, fn: (f: string, d: Deps) => void): void => {
    if (!existsSync(file)) return;
    try {
      fn(file, deps);
    } catch {
      // an unreadable manifest declares nothing
    }
  };
  for (const f of requirementFiles(dir)) read(f, (file) => readFileSync(file, "utf8").split(/\r?\n/).forEach((l) => addReq(deps, l)));
  read(path.join(dir, "pyproject.toml"), fromPyproject);
  read(path.join(dir, "Pipfile"), fromPipfile);
  read(dir, (d) => fromSetup(d, deps));
  return deps;
}

/** Python manifests: requirements files, pyproject.toml (PEP 621 and Poetry), Pipfile, setup.cfg and setup.py. */
export function pythonManifests(): Manifests {
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
      const name = normalizePypi(pkg);
      for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
        const deps = cached(dir);
        if (deps.has(name)) return deps.get(name);
        if (dir === rootDir || !dir.startsWith(rootDir) || path.dirname(dir) === dir) return undefined;
      }
    },
  };
}
