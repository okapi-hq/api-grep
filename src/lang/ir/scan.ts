import { readFileSync } from "node:fs";
import path from "node:path";
import { coverageRows, manifestDirs } from "../../coverage.js";
import { relativePosix } from "../../files.js";
import { sdkPackages } from "../../normalize/provider.js";
import { limitDiagnostics } from "../../operation/limits.js";
import { tableDiagnostics } from "../../resolve/choice.js";
import type { DiagnosticsCollector } from "../../report/diagnostics.js";
import type { Call, SdkCoverage } from "../../report/schema.js";
import { errorText, languageFiles, leftOutFiles, readEnvHints, type LeftOut } from "../files.js";
import { parserFor, syntaxError, type Parser, type Tree } from "../tree-sitter.js";
import type { LanguageFrontEnd, LanguageScanInput, LanguageScanResult } from "../types.js";
import { buildIrCall, type BuildIrCtx } from "./build.js";
import { detectIn, type Candidate, type IrUnfollowed } from "./detect.js";
import { collectHostLiterals } from "./host-literals.js";
import { sourcesOf, type IrLanguage, type IrSource } from "./language.js";
import type { ModuleModel } from "./model.js";
import { ProjectIndex } from "./project.js";
import { withAlternatives, type IrCtx, type IrRaw } from "./raw.js";
import { expandWrappers } from "./wrappers.js";

/** A file's syntax tree and its first syntax error; the language's same-length repair is tried when there is one. */
function parseFile(parser: Parser, lang: IrSource, text: string): { tree: Tree; problem?: string } {
  const tree = parser.parse(text);
  if (!tree) throw new Error("the parser returned no tree");
  const problem = syntaxError(tree, lang.allowHiddenErrors);
  const fixed = problem && lang.repair ? lang.repair(text) : text;
  if (fixed === text) return { tree, problem };
  const retry = parser.parse(fixed);
  if (retry && !syntaxError(retry, lang.allowHiddenErrors)) {
    tree.delete();
    return { tree: retry };
  }
  retry?.delete();
  return { tree, problem };
}

/**
 * Parses and lowers every file; a file that does not parse, or makes the lowering throw, is skipped, not fatal. Files
 * outside the scanned set are still read so imports resolve through them, but their problems are not reported (nor
 * their string literals, given to `hosts`).
 */
async function lowerAll(lang: IrSource, files: string[], scanned: Set<string>, input: LanguageScanInput): Promise<ModuleModel[]> {
  const { rootDir, diag, hosts } = input;
  const parser = await parserFor(lang.grammar);
  const modules: ModuleModel[] = [];
  try {
    for (const file of files) {
      const rel = relativePosix(rootDir, file);
      try {
        const { tree, problem } = parseFile(parser, lang, readFileSync(file, "utf8"));
        try {
          if (!problem) modules.push(Object.assign(lang.lower(tree.rootNode, file, rootDir), { language: lang.id }));
          else if (scanned.has(file)) diag.skip({ file: rel, reason: "parse-error", detail: problem });
          if (!problem && hosts && scanned.has(file)) collectHostLiterals(tree.rootNode, lang.id, rel, hosts, lang.testCode?.(tree.rootNode));
        } finally {
          tree.delete();
        }
      } catch (err) {
        if (scanned.has(file)) diag.skip({ file: rel, reason: "internal-error", detail: errorText(err) });
      }
    }
  } finally {
    parser.delete();
  }
  return modules;
}

/** Changed files plus the files importing them (one hop). */
function selectChanged(modules: ModuleModel[], changed: Set<string>, idx: ProjectIndex): ModuleModel[] {
  return modules.filter((m) => {
    if (changed.has(m.file)) return true;
    return m.importPaths.some((p) => {
      const hit = idx.resolvePath(p, m);
      if (!hit) return false;
      const target = hit.member.kind === "module" ? hit.member.mod : hit.member.kind === "class" ? hit.member.cls.module : hit.member.fn.module;
      return changed.has(target.file);
    });
  });
}

interface Detected {
  raws: IrRaw[];
  scanned: ModuleModel[];
}

function detectAll(modules: ModuleModel[], ctx: IrCtx, input: LanguageScanInput): Detected {
  const out: Detected = { raws: [], scanned: [] };
  for (const mod of modules) {
    const file = relativePosix(input.rootDir, mod.file);
    try {
      const candidates: Candidate[] = [];
      const unfollowed: IrUnfollowed[] = [];
      for (const fn of mod.allFunctions) {
        const found = detectIn(fn, ctx);
        out.raws.push(...found.calls);
        candidates.push(...found.candidates);
        unfollowed.push(...found.unfollowed);
      }
      for (const declared of ctx.idx.lang.declarations ?? []) out.raws.push(...declared(mod, ctx));
      const expanded = input.opts.wrappers !== false ? expandWrappers(candidates, ctx) : { calls: [], unfollowed: [] };
      out.raws.push(...expanded.calls);
      for (const u of [...unfollowed, ...expanded.unfollowed]) input.diag.unfollow({ file, line: u.call.pos.line, reason: u.reason, expr: u.expr, via: u.via });
      out.scanned.push(mod);
    } catch (err) {
      input.diag.skip({ file, reason: "internal-error", detail: errorText(err) });
    }
  }
  return out;
}

function buildAll(raws: IrRaw[], ctx: BuildIrCtx, diag: DiagnosticsCollector): Call[] {
  const calls: Call[] = [];
  for (const raw of raws.flatMap(withAlternatives)) {
    try {
      const built = buildIrCall(raw, ctx);
      calls.push(...built);
      for (const u of [...limitDiagnostics(built), ...tableDiagnostics(built)]) diag.unfollow(u);
    } catch (err) {
      diag.drop({ file: relativePosix(ctx.rootDir, raw.fn.module.file), line: raw.call.pos.line, reason: "internal-error", detail: errorText(err) });
    }
  }
  return calls;
}

/** Packages declared by the manifests between a file and the scanned directory, read once per directory. */
function declaredNear(lang: IrLanguage, rootDir: string): (file: string) => Set<string> {
  const memo = new Map<string, Set<string>>();
  return (file) => {
    const dir = path.dirname(file);
    let out = memo.get(dir);
    if (!out) memo.set(dir, (out = lang.manifests.declared(manifestDirs(rootDir, [file]), rootDir)));
    return out;
  };
}

/** SDK coverage of the language's ecosystem: the packages its manifests declare and its files import. */
function coverage(idx: ProjectIndex, rootDir: string, files: string[], scanned: ModuleModel[], calls: Call[]): SdkCoverage[] {
  const lang = idx.lang;
  const known = sdkPackages(lang.ecosystem);
  const declaredNames = lang.manifests.declared(manifestDirs(rootDir, files), rootDir);
  const declared = new Set([...known.keys()].filter((p) => declaredNames.has(lang.normalizePackage(p))));
  const roots = [...known.keys()].map((pkg) => ({ pkg, norm: lang.normalizePackage(pkg), roots: lang.importRoots(pkg, declared.has(pkg)).map((r) => r.split(".")) }));
  const sites = new Map<string, number>();
  const near = declaredNear(lang, rootDir);
  for (const mod of scanned) {
    const hit = new Set<string>();
    const own = near(mod.file);
    for (const p of mod.importPaths) {
      // the repository's own package of that name (`agents/` next to the code) is not the SDK
      if (idx.resolvePath(p, mod)) continue;
      // `Sentry\Laravel\Integration` is sentry/sentry-laravel's, not sentry/sentry's: the longest root wins, a declared
      // package's first (firebase-admin's `com.google.firebase.auth` is not the undeclared Android firebase-auth's), and
      // of those the one the file's own module declares (Spring AI's `ChatClient` is the module's model starter's)
      let best: { pkg: string; rank: number } | undefined;
      for (const r of roots) {
        for (const root of r.roots) {
          if (best && root.length + 2000 <= best.rank) continue;
          const rank = root.length + (declared.has(r.pkg) ? 1000 + (own.has(r.norm) ? 1000 : 0) : 0);
          if (root.every((s, i) => p[i] === s) && rank > (best?.rank ?? 0)) best = { pkg: r.pkg, rank };
        }
      }
      if (best) hit.add(best.pkg);
    }
    for (const pkg of hit) sites.set(pkg, (sites.get(pkg) ?? 0) + 1);
  }
  const supported = (pkg: string): boolean => lang.registry.some((r) => r.package === pkg || r.aliases?.includes(pkg));
  return coverageRows({ ecosystem: lang.ecosystem, known, declared, sites, calls, supported });
}

/** The files of one source language: in scope, left out by --include / --exclude, and every one to index. */
interface SourceFiles {
  source: IrSource;
  files: string[];
  leftOut: LeftOut[];
  all: string[];
}

function sourceFiles(source: IrSource, input: LanguageScanInput): SourceFiles {
  const { rootDir, opts } = input;
  const files = languageFiles(rootDir, source.extensions, opts.include, [...source.excludes, ...(opts.exclude ?? [])]);
  const leftOut = leftOutFiles({ dir: rootDir, include: opts.include, exclude: opts.exclude }, source.extensions, source.excludes, new Set(files));
  const all = [...new Set([...files, ...languageFiles(rootDir, source.extensions, undefined, source.excludes)])];
  return { source, files, leftOut, all };
}

/** Files seen and scanned per source language with files in scope. */
function fileCounts(sources: SourceFiles[], selected: ModuleModel[], scanned: ModuleModel[], changed: Set<string> | undefined): LanguageScanResult["files"] {
  const selectedFiles = new Set(selected.map((m) => m.file));
  const out: LanguageScanResult["files"] = {};
  for (const s of sources) {
    if (s.files.length === 0 && s.leftOut.length === 0) continue;
    const seen = changed ? s.files.filter((f) => changed.has(f) || selectedFiles.has(f)).length : s.files.length + s.leftOut.length;
    out[s.source.id] = { filesSeen: seen, filesScanned: scanned.filter((m) => m.language === s.source.id).length };
  }
  return out;
}

/**
 * Every source language of the front end the scan asks for (`--language`) is lowered into one set of modules and one
 * `ProjectIndex`, so names resolve across them (a Kotlin file calling a Retrofit interface declared in Java).
 */
async function scanIr(lang: IrLanguage, input: LanguageScanInput): Promise<LanguageScanResult | undefined> {
  const { rootDir, diag } = input;
  const sources = sourcesOf(lang)
    .filter((s) => input.languages.includes(s.id))
    .map((s) => sourceFiles(s, input));
  if (sources.every((s) => s.files.length === 0 && s.leftOut.length === 0)) return undefined;
  const files = sources.flatMap((s) => s.files);
  const inScope = new Set(files);
  const modules: ModuleModel[] = [];
  for (const s of sources) modules.push(...(await lowerAll(s.source, s.all, inScope, input)));
  lang.link?.(modules);
  const idx = new ProjectIndex(lang, modules);
  const scannable = modules.filter((m) => inScope.has(m.file));
  const selected = input.changed ? selectChanged(scannable, input.changed, idx) : scannable;
  if (!input.changed) for (const l of sources.flatMap((s) => s.leftOut)) diag.skip(l);
  const ctx: BuildIrCtx = {
    idx,
    declared: declaredNear(lang, rootDir),
    envHints: readEnvHints(rootDir),
    rootDir,
    language: lang.id,
    sdkVersion: (file, pkg) => lang.manifests.version(file, pkg, rootDir),
  };
  const { raws, scanned } = detectAll(selected, ctx, input);
  const calls = buildAll(raws, ctx, diag);
  const counts = fileCounts(sources, selected, scanned, input.changed);
  return { calls, files: counts, coverage: input.changed ? [] : coverage(idx, rootDir, files, scanned, calls) };
}

/** A tree-sitter language as a scanner front end: its own language and the ones it reads alongside. */
export function irLanguage(lang: IrLanguage): LanguageFrontEnd {
  return { ids: sourcesOf(lang).map((s) => s.id), ecosystem: lang.ecosystem, scan: (input) => scanIr(lang, input) };
}
