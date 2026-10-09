import { readdirSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { isInside, readConfigFile } from "../../files.js";
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
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const f of names) if (/^requirements.*\.(?:txt|in)$/i.test(f) || (d !== dir && /\.txt$/i.test(f))) out.push(path.join(d, f));
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

function fromPyproject(text: string, deps: Deps): void {
  const toml = parseToml(text) as {
    project?: { dependencies?: string[] };
    tool?: { poetry?: { dependencies?: Record<string, unknown> } };
  };
  for (const d of toml.project?.dependencies ?? []) addReq(deps, d);
  for (const [name, v] of Object.entries(toml.tool?.poetry?.dependencies ?? {})) {
    if (name.toLowerCase() === "python") continue;
    const spec = typeof v === "string" ? v : typeof v === "object" && v && "version" in v ? String(v.version) : undefined;
    if (!deps.has(normalizePypi(name))) deps.set(normalizePypi(name), spec);
  }
}

function fromPipfile(text: string, deps: Deps): void {
  const toml = parseToml(text) as { packages?: Record<string, unknown> };
  for (const [name, v] of Object.entries(toml.packages ?? {})) {
    const spec = typeof v === "string" && v !== "*" ? v.replace(/^==/, "") : undefined;
    if (!deps.has(normalizePypi(name))) deps.set(normalizePypi(name), spec);
  }
}

/** `install_requires` of setup.cfg: an indented list. */
function fromSetupCfg(text: string, deps: Deps): void {
  const m = /install_requires\s*=\s*\n((?:[ \t]+.*\n?)*)/.exec(text);
  for (const line of m?.[1]?.split("\n") ?? []) addReq(deps, line);
}

/** `install_requires` of setup.py: a list of string literals. */
function fromSetupPy(text: string, deps: Deps): void {
  const m = /install_requires\s*=\s*\[([^\]]*)\]/.exec(text);
  for (const s of m?.[1]?.matchAll(/["']([^"']+)["']/g) ?? []) addReq(deps, s[1]!);
}

function fromRequirements(text: string, deps: Deps): void {
  for (const line of text.split(/\r?\n/)) addReq(deps, line);
}

/**
 * Runtime dependencies declared in one directory, with their version specs. Manifests are read like other config
 * files (small regular files inside the scanned directory); one that does not parse declares nothing.
 */
function depsOf(dir: string, rootDir: string): Deps {
  const deps: Deps = new Map();
  const read = (file: string, fn: (text: string, d: Deps) => void): void => {
    const text = readConfigFile(file, rootDir);
    if (text === undefined) return;
    try {
      fn(text, deps);
    } catch {
      // an unreadable manifest declares nothing
    }
  };
  for (const f of requirementFiles(dir)) read(f, fromRequirements);
  read(path.join(dir, "pyproject.toml"), fromPyproject);
  read(path.join(dir, "Pipfile"), fromPipfile);
  read(path.join(dir, "setup.cfg"), fromSetupCfg);
  read(path.join(dir, "setup.py"), fromSetupPy);
  return deps;
}

/** Python manifests: requirements files, pyproject.toml (PEP 621 and Poetry), Pipfile, setup.cfg and setup.py. */
export function pythonManifests(): Manifests {
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
      const name = normalizePypi(pkg);
      for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
        const deps = cached(dir, rootDir);
        if (deps.has(name)) return deps.get(name);
        if (dir === rootDir || !isInside(rootDir, dir) || path.dirname(dir) === dir) return undefined;
      }
    },
  };
}
