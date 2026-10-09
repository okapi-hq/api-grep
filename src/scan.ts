import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { callId } from "./assemble.js";
import { buildExamples } from "./examples/build.js";
import type { Registry } from "./detect/registry/index.js";
import { changedFiles, headCommit } from "./git.js";
import { errorText } from "./lang/files.js";
import { selectLanguages } from "./lang/index.js";
import type { LanguageScanResult } from "./lang/types.js";
import { SCHEMA_URL, SCHEMA_VERSION, type Call, type Language, type Report, type SdkCoverage, type Stats } from "./report/schema.js";
import { DiagnosticsCollector } from "./report/diagnostics.js";
import { splitValid } from "./report/valid.js";
import { applySpecs } from "./validate/index.js";
import pkg from "../package.json" with { type: "json" };

export interface ScanOptions {
  dir: string;
  /** Languages to scan (default: every supported language with files in scope). */
  languages?: Language[];
  /** TypeScript: tsconfig.json to load (default: nearest). */
  tsconfig?: string;
  include?: string[];
  exclude?: string[];
  changedSince?: string;
  specs?: string;
  validate?: boolean;
  /** TypeScript SDK registry (default: the built-in one). */
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

interface Scanned {
  calls: Call[];
  filesSeen: number;
  filesScanned: number;
  coverage: SdkCoverage[];
  languages: Record<string, { filesSeen: number; filesScanned: number }>;
}

/** Runs each language front end in turn and merges what they found. */
async function scanLanguages(rootDir: string, opts: ScanOptions, diag: DiagnosticsCollector, changed?: Set<string>): Promise<Scanned> {
  const out: Scanned = { calls: [], filesSeen: 0, filesScanned: 0, coverage: [], languages: {} };
  for (const lang of selectLanguages(opts.languages)) {
    const r: LanguageScanResult | undefined = await lang.scan({ rootDir, opts, diag, changed });
    if (!r) continue;
    out.calls.push(...r.calls);
    out.filesSeen += r.filesSeen;
    out.filesScanned += r.filesScanned;
    out.coverage.push(...r.coverage);
    out.languages[lang.id] = { filesSeen: r.filesSeen, filesScanned: r.filesScanned };
  }
  return out;
}

export async function scan(opts: ScanOptions): Promise<Report> {
  const started = Date.now();
  const rootDir = path.resolve(opts.dir);
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) throw new Error(`directory not found: ${rootDir}`);
  const diag = new DiagnosticsCollector(opts.onWarning);
  const changed = opts.changedSince ? await changedFiles(rootDir, opts.changedSince) : undefined;
  const found = await scanLanguages(rootDir, opts, diag, changed);
  const built = onePerRequest(sortCalls(found.calls));
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
    stats: computeStats(calls, found.filesScanned, Date.now() - started),
    diagnostics: diag.finish(found.filesSeen, found.filesScanned, found.languages),
    // a --changed-since scan sees a few files: their imports say nothing about the repo's SDKs
    coverage: changed ? undefined : { sdks: found.coverage },
  };
}
