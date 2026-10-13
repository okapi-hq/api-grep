import { readFileSync } from "node:fs";
import path from "node:path";
import { defaultRegistry, type Registry } from "../../detect/registry/index.js";
import { relativePosix } from "../../files.js";
import { languageOf } from "../../language.js";
import { PackageJsonReader } from "../../package-json.js";
import { leftOutOf, scopeOf, tsFiles, type CheckerLanguage, type Scope, type Unreadable } from "../../project.js";
import type { Call } from "../../report/schema.js";
import { formCall } from "../html/forms.js";
import type { LanguageFrontEnd, LanguageScanInput, LanguageScanResult } from "../types.js";
import { Merged } from "./batched.js";
import { BATCH_BYTES, packBatches, projectOrder, sizeOf } from "./batches.js";
import { declaredPackages, importsCoverage } from "./coverage.js";
import { fileGroups, type FileGroups } from "./graph.js";

/** npm packages declared by the package.json files between a file and the scanned directory, read once per directory. */
function declaredNear(rootDir: string, packages: PackageJsonReader): (file: string) => Set<string> {
  const memo = new Map<string, Set<string>>();
  return (file) => {
    const dir = path.dirname(file);
    let out = memo.get(dir);
    if (!out) memo.set(dir, (out = declaredPackages(rootDir, [file], packages)));
    return out;
  };
}

const CHECKER_LANGUAGES: CheckerLanguage[] = ["typescript", "javascript", "html"];

/** Form submissions of the HTML pages in scope whose inline scripts could be read (a skipped page sends nothing). */
function formCalls(scope: Scope, pages: string[], scanned: Set<string>): Call[] {
  return pages.flatMap((p) => {
    const doc = scope.html.get(p)!;
    return doc.script && !scanned.has(p) ? [] : doc.forms.map((f) => formCall(f, relativePosix(scope.dir, p), scope.envHints));
  });
}

/** Files seen and scanned per language (an HTML page without inline script is scanned for its forms). */
function fileCounts(seen: string[], scanned: string[]): LanguageScanResult["files"] {
  const out: LanguageScanResult["files"] = {};
  for (const [list, key] of [[seen, "filesSeen"], [scanned, "filesScanned"]] as const) {
    for (const f of list) {
      const counts = (out[languageOf(f)] ??= { filesSeen: 0, filesScanned: 0 });
      counts[key]++;
    }
  }
  return out;
}

/** The files a project would hold: an HTML page without inline script, or that could not be read, is none. */
function sourceFiles(scope: Scope): string[] {
  const unreadable = new Set(scope.unreadable.map((u) => u.path));
  return scope.files.filter((f) => !unreadable.has(f) && (!/\.html?$/i.test(f) || !!scope.html.get(f)?.script));
}

function textOf(scope: Scope): (file: string) => string | undefined {
  return (file) => {
    const doc = scope.html.get(file);
    if (doc) return doc.script || undefined;
    try {
      return readFileSync(file, "utf8");
    } catch {
      return undefined;
    }
  };
}

/** A repository whose source fits in one batch is one group: reading every file's imports first would only cost time. */
function groupsOf(files: string[], scope: Scope, budget: number): FileGroups {
  if (files.reduce((a, f) => a + sizeOf(f), 0) <= budget) return { groups: [files.map((_, i) => i)], groupOf: () => undefined };
  return fileGroups({ files, options: scope.options, textOf: textOf(scope) });
}

/**
 * Scans the files in batches of files that can see each other, each in a project of its own (#68): a large monorepo
 * no longer holds every syntax tree and type at once. A batch reads its files in the order a single project would.
 */
function scanBatches(scope: Scope, input: LanguageScanInput, registry: Registry, packages: PackageJsonReader): Merged {
  const files = sourceFiles(scope);
  const budget = input.opts.batchBytes ?? BATCH_BYTES;
  const { groups, groupOf } = groupsOf(files, scope, budget);
  const order = projectOrder(files);
  const merged = new Merged();
  const ctx = {
    scope,
    registry,
    build: { rootDir: scope.dir, envHints: scope.envHints, sdkVersion: (file: string, name: string) => packages.versionOf(file, name) },
    wrappers: input.opts.wrappers !== false,
    changed: input.changed,
    declared: declaredNear(scope.dir, packages),
    groupOf,
    order,
  };
  for (const batch of packBatches(files, groups, budget, input.changed)) merged.scanBatch(batch, ctx);
  return merged;
}

/** Orders by `rank`, keeping the order of equals. */
function sortedBy<T>(items: T[], rank: (t: T) => number): T[] {
  return items
    .map((t, i) => ({ t, i, r: rank(t) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t);
}

/** Unreadable files in load order, and files --include / --exclude left out, reported before what the batches found. */
function reportScope(scope: Scope, merged: Merged, input: LanguageScanInput): { unreadable: Unreadable[]; leftOut: string[] } {
  const index = new Map(scope.files.map((f, i) => [f, i]));
  let unreadable = sortedBy([...scope.unreadable, ...merged.unreadable], (u) => index.get(u.path) ?? 0);
  if (input.changed) unreadable = unreadable.filter((u) => input.changed!.has(u.path));
  for (const u of unreadable) input.diag.skip({ file: u.file, reason: "parse-error", detail: u.detail });
  if (input.changed) return { unreadable, leftOut: [] };
  const leftOut = leftOutOf(scope, [...merged.loaded, ...unreadable.map((u) => u.path)]);
  for (const l of leftOut) input.diag.skip(l);
  return { unreadable, leftOut: leftOut.map((l) => path.join(scope.dir, l.file)) };
}

/** Rank of each file (absolute path) in a single project of every file, the dependencies the batches pulled in last. */
function singleProjectOrder(scope: Scope, merged: Merged): (file: string) => number {
  const sources = new Set(sourceFiles(scope));
  const failed = new Set(merged.unreadable.map((u) => u.path));
  const order = projectOrder([...sources].filter((f) => !failed.has(f)).concat(merged.loaded.filter((f) => !sources.has(f))));
  return (file) => order.get(file) ?? Number.MAX_SAFE_INTEGER;
}

/** Calls, diagnostics, coverage and file counts of the batches, in the order of a single-project scan. */
function finish(scope: Scope, merged: Merged, input: LanguageScanInput, registry: Registry, packages: PackageJsonReader): LanguageScanResult {
  const { unreadable, leftOut } = reportScope(scope, merged, input);
  const rank = singleProjectOrder(scope, merged);
  const relative = new Map(merged.loaded.map((f) => [relativePosix(scope.dir, f), rank(f)]));
  const rankOf = (file: string): number => relative.get(file) ?? Number.MAX_SAFE_INTEGER;
  merged.log.flush(input.diag, rankOf);
  const selected = new Set(merged.selected);
  const pages = [...scope.html.keys()].filter((p) => !input.changed || input.changed.has(p) || selected.has(p));
  const scanned = new Set(merged.scanned);
  const calls = [...sortedBy(merged.calls, (c) => rankOf(c.location.file)), ...formCalls(scope, pages, scanned)];
  const plainPages = pages.filter((p) => !scope.html.get(p)!.script);
  const pageImports = pages.filter((p) => scanned.has(p) || plainPages.includes(p)).map((p) => ({ file: p, packages: scope.html.get(p)!.cdnPackages }));
  const imports = new Map(sortedBy([...merged.imports], ([f]) => rank(f)));
  // a --changed-since scan sees a few files: their imports say nothing about the repo's SDKs
  const coverage = input.changed ? [] : importsCoverage(scope.dir, imports, calls, registry, pageImports, packages).sdks;
  const kept = sortedBy(input.changed ? merged.selected : merged.loaded, rank);
  const seen = [...kept, ...(input.changed ? [] : leftOut), ...unreadable.map((u) => u.path)];
  return { calls, files: fileCounts([...seen, ...plainPages], [...scanned, ...plainPages]), coverage };
}

function scanTypeScript(input: LanguageScanInput): LanguageScanResult | undefined {
  const { rootDir, opts } = input;
  const languages = CHECKER_LANGUAGES.filter((l) => input.languages.includes(l));
  // a directory without TypeScript, JavaScript or HTML (a Python repository) never pays for a ts-morph Project
  if (tsFiles(rootDir, undefined, [], languages).length === 0) return undefined;
  const registry = opts.registry ?? defaultRegistry();
  const scope = scopeOf({ dir: rootDir, tsconfig: opts.tsconfig, include: opts.include, exclude: opts.exclude, languages });
  const packages = new PackageJsonReader(rootDir);
  return finish(scope, scanBatches(scope, input, registry, packages), input, registry, packages);
}

export const typescript: LanguageFrontEnd = { ids: CHECKER_LANGUAGES, ecosystem: "npm", scan: (input) => Promise.resolve(scanTypeScript(input)) };
