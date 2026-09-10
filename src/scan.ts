import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildCall, type BuildCtx } from "./build-call.js";
import { detectFile } from "./detect/index.js";
import { buildExamples } from "./examples/build.js";
import { defaultRegistry, type Registry } from "./detect/registry/index.js";
import { changedFiles, headCommit, selectChanged } from "./git.js";
import { loadProject } from "./project.js";
import type { Call, Report, Stats } from "./report/schema.js";
import type { RawCall } from "./types.js";
import { applySpecs } from "./validate/index.js";
import { expandWrappers } from "./wrappers/detect.js";
import pkg from "../package.json" with { type: "json" };

export interface ScanOptions {
  dir: string;
  tsconfig?: string;
  include?: string[];
  exclude?: string[];
  changedSince?: string;
  specs?: string;
  validate?: boolean;
  registry?: Registry;
  repo?: string;
  wrappers?: boolean;
  /** Maximum example requests per call (default 3, 0 disables). */
  examples?: number;
}

function sdkVersionLookup(rootDir: string): BuildCtx["sdkVersion"] {
  const cache = new Map<string, Record<string, string>>();
  const depsOf = (dir: string): Record<string, string> => {
    const hit = cache.get(dir);
    if (hit) return hit;
    let deps: Record<string, string> = {};
    const file = path.join(dir, "package.json");
    if (existsSync(file)) {
      try {
        const json = JSON.parse(readFileSync(file, "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        deps = { ...(json.devDependencies ?? {}), ...(json.dependencies ?? {}) };
      } catch {
        deps = {};
      }
    }
    cache.set(dir, deps);
    return deps;
  };
  return (file, pkgName) => {
    let dir = path.dirname(file);
    for (let i = 0; i < 8; i++) {
      const v = depsOf(dir)[pkgName];
      if (v) return v;
      if (dir === rootDir || path.dirname(dir) === dir) break;
      dir = path.dirname(dir);
    }
    return depsOf(rootDir)[pkgName];
  };
}

function count<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) out[key(it)] = (out[key(it)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

export function computeStats(calls: Call[], filesScanned: number, durationMs: number): Stats {
  return {
    filesScanned,
    callsFound: calls.length,
    byClient: count(calls, (c) => c.client),
    byProvider: count(calls, (c) => c.provider),
    byHostKind: count(calls, (c) => c.hostKind),
    withBodyShape: calls.filter((c) => c.body && (c.body as { type: string }).type !== "dynamic" && (c.body as { type: string }).type !== "unknown").length,
    withDynamic: calls.filter((c) => c.dynamic.length > 0).length,
    withFindings: calls.filter((c) => c.findings.length > 0).length,
    redacted: 0,
    durationMs,
  };
}

function sortCalls(calls: Call[]): Call[] {
  return calls.sort((a, b) => a.location.file.localeCompare(b.location.file) || a.location.line - b.location.line || a.location.col - b.location.col);
}

export async function scan(opts: ScanOptions): Promise<Report> {
  const started = Date.now();
  const rootDir = path.resolve(opts.dir);
  const registry = opts.registry ?? defaultRegistry();
  const loaded = loadProject({ dir: rootDir, tsconfig: opts.tsconfig, include: opts.include, exclude: opts.exclude });
  let files = loaded.files;
  if (opts.changedSince) files = selectChanged(files, await changedFiles(rootDir, opts.changedSince));
  const raws: RawCall[] = [];
  for (const sf of files) {
    const { calls, candidates } = detectFile(sf, registry);
    raws.push(...calls);
    if (opts.wrappers !== false) raws.push(...expandWrappers(candidates, registry));
  }
  const ctx: BuildCtx = { rootDir, envHints: loaded.envHints, sdkVersion: sdkVersionLookup(rootDir) };
  const calls = sortCalls(raws.map((r) => buildCall(r, ctx)));
  if (opts.specs) await applySpecs(calls, { specsDir: opts.specs, validate: !!opts.validate });
  const maxExamples = opts.examples ?? 3;
  if (maxExamples > 0) for (const c of calls) c.examples = buildExamples(c, maxExamples);
  return {
    tool: "apicalls",
    version: pkg.version,
    repo: opts.repo,
    commit: await headCommit(rootDir),
    calls,
    stats: computeStats(calls, files.length, Date.now() - started),
  };
}
