import path from "node:path";
import { ts, type Node, type SourceFile } from "ts-morph";
import { buildCall, type BuildCtx } from "../../build-call.js";
import { detectFile } from "../../detect/index.js";
import { defaultRegistry, type Registry } from "../../detect/registry/index.js";
import { selectChanged } from "../../git.js";
import { relativePosix } from "../../files.js";
import { languageOf } from "../../language.js";
import { PackageJsonReader } from "../../package-json.js";
import { loadProject, tsFiles, type CheckerLanguage, type Loaded } from "../../project.js";
import type { DiagnosticsCollector } from "../../report/diagnostics.js";
import type { Call } from "../../report/schema.js";
import type { RawCall } from "../../types.js";
import { expandWrappers } from "../../wrappers/detect.js";
import { errorText } from "../files.js";
import { formCall } from "../html/forms.js";
import type { LanguageFrontEnd, LanguageScanInput, LanguageScanResult } from "../types.js";
import { sdkCoverage } from "./coverage.js";

/** Why a file cannot be read reliably: a syntax error, or an import whose module specifier is not a string literal. */
function parseProblem(sf: SourceFile): string | undefined {
  const syntax = sf.getProject().getProgram().compilerObject.getSyntacticDiagnostics(sf.compilerNode)[0];
  if (syntax) return ts.flattenDiagnosticMessageText(syntax.messageText, " ");
  const decls = [...sf.getImportDeclarations(), ...sf.getExportDeclarations()];
  const bad = decls.some((d) => d.compilerNode.moduleSpecifier !== undefined && !ts.isStringLiteral(d.compilerNode.moduleSpecifier));
  return bad ? "Expected the module specifier to be a string literal." : undefined;
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
    const file = relativePosix(input.rootDir, sf.getFilePath());
    try {
      const problem = parseProblem(sf);
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
      diag.drop({ file: relativePosix(ctx.rootDir, raw.node.getSourceFile().getFilePath()), line: lineOf(raw.node), reason: "internal-error", detail: errorText(err) });
    }
  }
  return calls;
}

interface InScope {
  files: SourceFile[];
  /** HTML pages in scope (absolute paths). */
  pages: string[];
  /** Every file this scan saw, HTML pages without inline script aside (absolute paths). */
  seen: string[];
}

/** The files this scan covers; what it leaves out (unreadable, or removed by the options) goes to diagnostics. */
function filesInScope(loaded: Loaded, input: LanguageScanInput): InScope {
  const parseError = (u: Loaded["unreadable"][number]): void => input.diag.skip({ file: u.file, reason: "parse-error", detail: u.detail });
  const paths = (files: SourceFile[]): string[] => files.map((sf) => sf.getFilePath() as string);
  const pages = [...loaded.html.keys()];
  if (input.changed) {
    const changed = input.changed;
    const unreadable = loaded.unreadable.filter((u) => changed.has(u.path));
    unreadable.forEach(parseError);
    const files = selectChanged(loaded.files, changed);
    const kept = new Set(paths(files));
    return { files, pages: pages.filter((p) => changed.has(p) || kept.has(p)), seen: [...kept, ...unreadable.map((u) => u.path)] };
  }
  loaded.unreadable.forEach(parseError);
  for (const l of loaded.leftOut) input.diag.skip(l);
  const leftOut = loaded.leftOut.map((l) => path.join(input.rootDir, l.file));
  return { files: loaded.files, pages, seen: [...paths(loaded.files), ...leftOut, ...loaded.unreadable.map((u) => u.path)] };
}

const CHECKER_LANGUAGES: CheckerLanguage[] = ["typescript", "javascript", "html"];

/** Form submissions of the HTML pages in scope whose inline scripts could be read (a skipped page sends nothing). */
function formCalls(loaded: Loaded, pages: string[], scanned: Set<string>, rootDir: string): Call[] {
  return pages.flatMap((p) => {
    const doc = loaded.html.get(p)!;
    return doc.script && !scanned.has(p) ? [] : doc.forms.map((f) => formCall(f, relativePosix(rootDir, p), loaded.envHints));
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

function scanTypeScript(input: LanguageScanInput): LanguageScanResult | undefined {
  const { rootDir, opts, diag } = input;
  const languages = CHECKER_LANGUAGES.filter((l) => input.languages.includes(l));
  // a directory without TypeScript, JavaScript or HTML (a Python repository) never pays for a ts-morph Project
  if (tsFiles(rootDir, undefined, [], languages).length === 0) return undefined;
  const registry = opts.registry ?? defaultRegistry();
  const loaded = loadProject({ dir: rootDir, tsconfig: opts.tsconfig, include: opts.include, exclude: opts.exclude, languages });
  const { files, pages, seen } = filesInScope(loaded, input);
  const { raws, scanned } = detectAll(files, registry, input);
  const scannedPaths = new Set(scanned.map((sf) => sf.getFilePath() as string));
  const packages = new PackageJsonReader(rootDir);
  const ctx: BuildCtx = { rootDir, envHints: loaded.envHints, sdkVersion: (file, name) => packages.versionOf(file, name) };
  const calls = [...buildAll(raws, ctx, diag), ...formCalls(loaded, pages, scannedPaths, rootDir)];
  const plainPages = pages.filter((p) => !loaded.html.get(p)!.script);
  const pageImports = pages.filter((p) => scannedPaths.has(p) || plainPages.includes(p)).map((p) => ({ file: p, packages: loaded.html.get(p)!.cdnPackages }));
  // a --changed-since scan sees a few files: their imports say nothing about the repo's SDKs
  const coverage = input.changed ? [] : sdkCoverage(rootDir, scanned, calls, registry, pageImports, packages).sdks;
  return { calls, files: fileCounts([...seen, ...plainPages], [...scannedPaths, ...plainPages]), coverage };
}

export const typescript: LanguageFrontEnd = { ids: CHECKER_LANGUAGES, ecosystem: "npm", scan: (input) => Promise.resolve(scanTypeScript(input)) };
