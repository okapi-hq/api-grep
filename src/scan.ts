import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { ts, type Node, type SourceFile } from "ts-morph";
import { buildCall, callId, type BuildCtx } from "./build-call.js";
import { sdkCoverage } from "./coverage.js";
import { detectFile } from "./detect/index.js";
import { buildExamples } from "./examples/build.js";
import { defaultRegistry, type Registry } from "./detect/registry/index.js";
import { changedFiles, headCommit, selectChanged } from "./git.js";
import { PackageJsonReader } from "./package-json.js";
import { relativePosix } from "./files.js";
import { loadProject, type Loaded, type Unreadable } from "./project.js";
import { SCHEMA_URL, SCHEMA_VERSION, type Call, type Report, type Stats } from "./report/schema.js";
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

/** Occurrences per key, most frequent first. A Map: keys come from the scanned code (`constructor` is a provider name). */
function count<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out = new Map<string, number>();
  for (const it of items) out.set(key(it), (out.get(key(it)) ?? 0) + 1);
  return Object.fromEntries([...out].sort((a, b) => b[1] - a[1]));
}

export function computeStats(calls: Call[], filesScanned: number, durationMs: number): Stats {
  return {
    filesScanned,
    callsFound: calls.length,
    byLanguage: count(calls, (c) => c.location.language),
    byClient: count(calls, (c) => c.client),
    byProvider: count(calls, (c) => c.provider),
    byHostKind: count(calls, (c) => c.hostKind),
    withBodyShape: calls.filter((c) => c.body && c.body.type !== "dynamic" && c.body.type !== "unknown").length,
    withDynamic: calls.filter((c) => c.dynamic.length > 0).length,
    withFindings: calls.filter((c) => c.findings.length > 0).length,
    redacted: 0,
    durationMs,
  };
}

function sortCalls(calls: Call[]): Call[] {
  return calls.sort((a, b) => a.location.file.localeCompare(b.location.file) || a.location.line - b.location.line || a.location.col - b.location.col);
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
  scanned: SourceFile[];
}

/** Runs every detector on each file; a file that cannot be read or makes a detector throw is skipped, not fatal. */
function detectAll(files: SourceFile[], registry: Registry, opts: ScanOptions, rootDir: string, diag: DiagnosticsCollector): Detected {
  const raws: RawCall[] = [];
  const scanned: SourceFile[] = [];
  for (const sf of files) {
    const file = relativePosix(rootDir, sf.getFilePath());
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
      scanned.push(sf);
    } catch (err) {
      diag.skip({ file, reason: "internal-error", detail: errorText(err) });
    }
  }
  return { raws, scanned };
}

/**
 * One call per request per call site: a wrapper that reaches the same request twice (a retry, two branches building it)
 * gives it once; different requests from one call site keep distinct ids.
 */
function onePerRequest(calls: Call[]): Call[] {
  const seen = new Set<string>();
  const perSite = new Map<string, number>();
  return calls.flatMap((c) => {
    const { id, ...request } = c;
    const key = `${id}:${JSON.stringify(request)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const n = perSite.get(id) ?? 0;
    perSite.set(id, n + 1);
    return [n === 0 ? c : { ...c, id: callId(c.location, n) }];
  });
}

function buildAll(raws: RawCall[], ctx: BuildCtx, diag: DiagnosticsCollector): Call[] {
  const calls: Call[] = [];
  for (const raw of raws) {
    try {
      calls.push(buildCall(raw, ctx));
    } catch (err) {
      diag.drop({ file: relativePosix(ctx.rootDir, raw.node.getSourceFile().getFilePath()), line: lineOf(raw.node), reason: "internal-error", detail: errorText(err) });
    }
  }
  return onePerRequest(sortCalls(calls));
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

/** The files this scan covers; what it leaves out (unreadable, or removed by the options) goes to diagnostics. */
async function filesInScope(loaded: Loaded, opts: ScanOptions, rootDir: string, diag: DiagnosticsCollector): Promise<{ files: SourceFile[]; seen: number }> {
  const parseError = (u: Unreadable): void => diag.skip({ file: u.file, reason: "parse-error", detail: u.detail });
  if (opts.changedSince) {
    const changed = await changedFiles(rootDir, opts.changedSince);
    const unreadable = loaded.unreadable.filter((u) => changed.has(u.path));
    unreadable.forEach(parseError);
    const files = selectChanged(loaded.files, changed);
    return { files, seen: files.length + unreadable.length };
  }
  loaded.unreadable.forEach(parseError);
  for (const l of loaded.leftOut) diag.skip(l);
  return { files: loaded.files, seen: loaded.files.length + loaded.leftOut.length + loaded.unreadable.length };
}

export async function scan(opts: ScanOptions): Promise<Report> {
  const started = Date.now();
  const rootDir = path.resolve(opts.dir);
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) throw new Error(`directory not found: ${rootDir}`);
  const registry = opts.registry ?? defaultRegistry();
  const diag = new DiagnosticsCollector(opts.onWarning);
  const loaded = loadProject({ dir: rootDir, tsconfig: opts.tsconfig, include: opts.include, exclude: opts.exclude });
  const { files, seen } = await filesInScope(loaded, opts, rootDir, diag);
  const { raws, scanned } = detectAll(files, registry, opts, rootDir, diag);
  const packages = new PackageJsonReader(rootDir);
  const ctx: BuildCtx = { rootDir, envHints: loaded.envHints, sdkVersion: (file, name) => packages.versionOf(file, name) };
  const built = buildAll(raws, ctx, diag);
  if (opts.specs) await applySpecs(built, { specsDir: opts.specs, validate: !!opts.validate, onWarning: opts.onWarning });
  const { valid: calls, dropped } = splitValid(withExamples(built, opts.examples ?? 3, opts));
  for (const d of dropped) diag.drop(d);
  return {
    $schema: SCHEMA_URL,
    schemaVersion: SCHEMA_VERSION,
    tool: "apicalls",
    version: pkg.version,
    repo: opts.repo,
    commit: await headCommit(rootDir),
    calls,
    stats: computeStats(calls, scanned.length, Date.now() - started),
    diagnostics: diag.finish(seen, scanned.length),
    // a --changed-since scan sees a few files: their imports say nothing about the repo's SDKs
    coverage: opts.changedSince ? undefined : sdkCoverage(rootDir, scanned, calls, registry, packages),
  };
}
