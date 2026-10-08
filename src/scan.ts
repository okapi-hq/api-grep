import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ts, type Node, type SourceFile } from "ts-morph";
import { buildCall, type BuildCtx } from "./build-call.js";
import { detectFile } from "./detect/index.js";
import { buildExamples } from "./examples/build.js";
import { defaultRegistry, type Registry } from "./detect/registry/index.js";
import { changedFiles, headCommit, selectChanged } from "./git.js";
import { loadProject } from "./project.js";
import type { Call, Report, Stats } from "./report/schema.js";
import { DiagnosticsCollector } from "./report/diagnostics.js";
import { splitValid } from "./report/valid.js";
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
  /** Receives one line per unreadable file and per dropped call (also listed in `diagnostics`); the scan never stops on them. */
  onWarning?: (message: string) => void;
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

function relPath(rootDir: string, file: string): string {
  return path.relative(rootDir, file).split(path.sep).join("/");
}

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0]!;
}

function lineOf(node: Node): number {
  return node.getSourceFile().getLineAndColumnAtPos(node.getStart()).line;
}

/** Why a file cannot be read reliably: a syntax error, or an import whose module specifier is not a string literal. */
function unreadable(sf: SourceFile): string | undefined {
  const syntax = sf.getProject().getProgram().compilerObject.getSyntacticDiagnostics(sf.compilerNode)[0];
  if (syntax) return ts.flattenDiagnosticMessageText(syntax.messageText, " ");
  const decls = [...sf.getImportDeclarations(), ...sf.getExportDeclarations()];
  const bad = decls.some((d) => d.compilerNode.moduleSpecifier !== undefined && !ts.isStringLiteral(d.compilerNode.moduleSpecifier));
  return bad ? "Expected the module specifier to be a string literal." : undefined;
}

interface Detected {
  raws: RawCall[];
  scanned: number;
}

/** Runs every detector on each file; a file that cannot be read or makes a detector throw is skipped, not fatal. */
function detectAll(files: SourceFile[], registry: Registry, opts: ScanOptions, rootDir: string, diag: DiagnosticsCollector): Detected {
  const raws: RawCall[] = [];
  let scanned = 0;
  for (const sf of files) {
    const file = relPath(rootDir, sf.getFilePath());
    try {
      const problem = unreadable(sf);
      if (problem) {
        diag.skip({ file, reason: "parse-error", detail: problem });
        continue;
      }
      const { calls, candidates, unfollowed } = detectFile(sf, registry);
      const expanded = opts.wrappers !== false ? expandWrappers(candidates, registry) : { calls: [], unfollowed: [] };
      raws.push(...calls, ...expanded.calls);
      for (const u of [...unfollowed, ...expanded.unfollowed]) diag.unfollow({ file, line: lineOf(u.node), reason: u.reason, expr: u.expr, via: u.via });
      scanned++;
    } catch (err) {
      diag.skip({ file, reason: "internal-error", detail: errorText(err) });
    }
  }
  return { raws, scanned };
}

function buildAll(raws: RawCall[], ctx: BuildCtx, diag: DiagnosticsCollector): Call[] {
  const calls: Call[] = [];
  for (const raw of raws) {
    try {
      calls.push(buildCall(raw, ctx));
    } catch (err) {
      diag.drop({ file: relPath(ctx.rootDir, raw.node.getSourceFile().getFilePath()), line: lineOf(raw.node), reason: "internal-error", detail: errorText(err) });
    }
  }
  return sortCalls(calls);
}

function withExamples(calls: Call[], max: number, opts: ScanOptions): Call[] {
  if (max <= 0) return calls;
  for (const c of calls) {
    try {
      c.examples = buildExamples(c, max);
    } catch (err) {
      opts.onWarning?.(`no examples for call at ${c.location.file}:${c.location.line}: ${errorText(err)}`);
    }
  }
  return calls;
}

export async function scan(opts: ScanOptions): Promise<Report> {
  const started = Date.now();
  const rootDir = path.resolve(opts.dir);
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) throw new Error(`directory not found: ${rootDir}`);
  const registry = opts.registry ?? defaultRegistry();
  const diag = new DiagnosticsCollector(opts.onWarning);
  const loaded = loadProject({ dir: rootDir, tsconfig: opts.tsconfig, include: opts.include, exclude: opts.exclude });
  let files = loaded.files;
  if (opts.changedSince) files = selectChanged(files, await changedFiles(rootDir, opts.changedSince));
  else for (const l of loaded.leftOut) diag.skip(l);
  const { raws, scanned } = detectAll(files, registry, opts, rootDir, diag);
  const ctx: BuildCtx = { rootDir, envHints: loaded.envHints, sdkVersion: sdkVersionLookup(rootDir) };
  const built = buildAll(raws, ctx, diag);
  if (opts.specs) await applySpecs(built, { specsDir: opts.specs, validate: !!opts.validate });
  const { valid: calls, dropped } = splitValid(withExamples(built, opts.examples ?? 3, opts));
  for (const d of dropped) diag.drop(d);
  const filesSeen = opts.changedSince ? files.length : files.length + loaded.leftOut.length;
  return {
    tool: "apicalls",
    version: pkg.version,
    repo: opts.repo,
    commit: await headCommit(rootDir),
    calls,
    stats: computeStats(calls, scanned, Date.now() - started),
    diagnostics: diag.finish(filesSeen, scanned),
  };
}
