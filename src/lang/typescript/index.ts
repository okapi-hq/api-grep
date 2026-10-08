import type { Node, SourceFile } from "ts-morph";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildCall, type BuildCtx } from "../../build-call.js";
import { detectFile } from "../../detect/index.js";
import { defaultRegistry, type Registry } from "../../detect/registry/index.js";
import { selectChanged } from "../../git.js";
import { languageOf } from "../../language.js";
import { loadProject, tsFiles, unreadable, type CheckerLanguage, type Loaded } from "../../project.js";
import type { DiagnosticsCollector } from "../../report/diagnostics.js";
import type { Call } from "../../report/schema.js";
import type { RawCall } from "../../types.js";
import { expandWrappers } from "../../wrappers/detect.js";
import { errorText, relPath } from "../files.js";
import { formCall } from "../html/forms.js";
import type { LanguageFrontEnd, LanguageScanInput, LanguageScanResult } from "../types.js";
import { sdkCoverage } from "./coverage.js";

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

function lineOf(node: Node): number {
  return node.getSourceFile().getLineAndColumnAtPos(node.getStart()).line;
}

interface Detected {
  raws: RawCall[];
  scanned: SourceFile[];
}

/** Runs every detector on each file; a file that cannot be read or makes a detector throw is skipped, not fatal. */
function detectAll(files: SourceFile[], registry: Registry, input: LanguageScanInput): Detected {
  const raws: RawCall[] = [];
  const scanned: SourceFile[] = [];
  for (const sf of files) {
    const file = relPath(input.rootDir, sf.getFilePath());
    try {
      const problem = unreadable(sf);
      if (problem) {
        input.diag.skip({ file, reason: "parse-error", detail: problem });
        continue;
      }
      const { calls, candidates, unfollowed } = detectFile(sf, registry);
      const expanded = input.opts.wrappers !== false ? expandWrappers(candidates, registry) : { calls: [], unfollowed: [] };
      raws.push(...calls, ...expanded.calls);
      for (const u of [...unfollowed, ...expanded.unfollowed]) input.diag.unfollow({ file, line: lineOf(u.node), reason: u.reason, expr: u.expr, via: u.via });
      scanned.push(sf);
    } catch (err) {
      input.diag.skip({ file, reason: "internal-error", detail: errorText(err) });
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
  return calls;
}

const CHECKER_LANGUAGES: CheckerLanguage[] = ["typescript", "javascript", "html"];

/** Form submissions of the HTML pages in scope whose inline scripts could be read (a skipped page sends nothing). */
function formCalls(loaded: Loaded, pages: string[], scanned: Set<string>, rootDir: string): Call[] {
  return pages.flatMap((p) => {
    const doc = loaded.html.get(p)!;
    return doc.script && !scanned.has(p) ? [] : doc.forms.map((f) => formCall(f, relPath(rootDir, p), loaded.envHints));
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

async function scanTypeScript(input: LanguageScanInput): Promise<LanguageScanResult | undefined> {
  const { rootDir, opts, diag } = input;
  const languages = CHECKER_LANGUAGES.filter((l) => input.languages.includes(l));
  // a directory without TypeScript, JavaScript or HTML (a Python repository) never pays for a ts-morph Project
  if (tsFiles(rootDir, undefined, [], languages).length === 0) return undefined;
  const registry = opts.registry ?? defaultRegistry();
  const loaded = loadProject({ dir: rootDir, tsconfig: opts.tsconfig, include: opts.include, exclude: opts.exclude, languages });
  let files = loaded.files;
  let pages = [...loaded.html.keys()];
  if (input.changed) {
    files = selectChanged(files, input.changed);
    pages = pages.filter((p) => input.changed!.has(p) || files.some((sf) => sf.getFilePath() === p));
  } else for (const l of loaded.leftOut) diag.skip(l);
  const { raws, scanned } = detectAll(files, registry, input);
  const scannedPaths = new Set(scanned.map((sf) => sf.getFilePath() as string));
  const calls = [...buildAll(raws, { rootDir, envHints: loaded.envHints, sdkVersion: sdkVersionLookup(rootDir) }, diag), ...formCalls(loaded, pages, scannedPaths, rootDir)];
  const plainPages = pages.filter((p) => !loaded.html.get(p)!.script);
  const seen = [...files.map((sf) => sf.getFilePath() as string), ...plainPages, ...(input.changed ? [] : loaded.leftOut.map((l) => path.join(rootDir, l.file)))];
  const pageImports = pages.filter((p) => scannedPaths.has(p) || plainPages.includes(p)).map((p) => ({ file: p, packages: loaded.html.get(p)!.cdnPackages }));
  // a --changed-since scan sees a few files: their imports say nothing about the repo's SDKs
  const coverage = input.changed ? [] : sdkCoverage(rootDir, scanned, calls, registry, pageImports).sdks;
  return { calls, files: fileCounts(seen, [...scannedPaths, ...plainPages]), coverage };
}

export const typescript: LanguageFrontEnd = { ids: CHECKER_LANGUAGES, ecosystem: "npm", scan: scanTypeScript };
