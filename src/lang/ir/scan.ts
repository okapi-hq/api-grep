import { readFileSync } from "node:fs";
import { coverageRows, manifestDirs } from "../../coverage.js";
import { relativePosix } from "../../files.js";
import { sdkPackages } from "../../normalize/provider.js";
import type { DiagnosticsCollector } from "../../report/diagnostics.js";
import type { Call, SdkCoverage } from "../../report/schema.js";
import { errorText, languageFiles, leftOutFiles, readEnvHints } from "../files.js";
import { parserFor, syntaxError } from "../tree-sitter.js";
import type { LanguageFrontEnd, LanguageScanInput, LanguageScanResult } from "../types.js";
import { buildIrCall, type BuildIrCtx } from "./build.js";
import { detectIn, type Candidate, type IrUnfollowed } from "./detect.js";
import type { IrLanguage } from "./language.js";
import type { ModuleModel } from "./model.js";
import { ProjectIndex } from "./project.js";
import type { IrCtx, IrRaw } from "./raw.js";
import { expandWrappers } from "./wrappers.js";

/**
 * Parses and lowers every file; a file that does not parse, or makes the lowering throw, is skipped, not fatal. Files
 * outside the scanned set are still read so imports resolve through them, but their problems are not reported.
 */
async function lowerAll(lang: IrLanguage, files: string[], scanned: Set<string>, rootDir: string, diag: DiagnosticsCollector): Promise<ModuleModel[]> {
  const parser = await parserFor(lang.grammar);
  const modules: ModuleModel[] = [];
  try {
    for (const file of files) {
      const rel = relativePosix(rootDir, file);
      try {
        const tree = parser.parse(readFileSync(file, "utf8"));
        if (!tree) throw new Error("the parser returned no tree");
        try {
          const problem = syntaxError(tree);
          if (!problem) modules.push(lang.lower(tree.rootNode, file, rootDir));
          else if (scanned.has(file)) diag.skip({ file: rel, reason: "parse-error", detail: problem });
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
  for (const raw of raws) {
    try {
      calls.push(buildIrCall(raw, ctx));
    } catch (err) {
      diag.drop({ file: relativePosix(ctx.rootDir, raw.fn.module.file), line: raw.call.pos.line, reason: "internal-error", detail: errorText(err) });
    }
  }
  return calls;
}

/** SDK coverage of the language's ecosystem: the packages its manifests declare and its files import. */
function coverage(lang: IrLanguage, rootDir: string, files: string[], scanned: ModuleModel[], calls: Call[]): SdkCoverage[] {
  const known = sdkPackages(lang.ecosystem);
  const declaredNames = lang.manifests.declared(manifestDirs(rootDir, files), rootDir);
  const declared = new Set([...known.keys()].filter((p) => declaredNames.has(lang.normalizePackage(p))));
  const roots = [...known.keys()].map((pkg) => ({ pkg, roots: lang.importRoots(pkg).map((r) => r.split(".")) }));
  const sites = new Map<string, number>();
  for (const mod of scanned) {
    const hit = new Set<string>();
    for (const p of mod.importPaths) for (const r of roots) if (r.roots.some((root) => root.every((s, i) => p[i] === s))) hit.add(r.pkg);
    for (const pkg of hit) sites.set(pkg, (sites.get(pkg) ?? 0) + 1);
  }
  const supported = (pkg: string): boolean => lang.registry.some((r) => r.package === pkg || r.aliases?.includes(pkg));
  return coverageRows({ ecosystem: lang.ecosystem, known, declared, sites, calls, supported });
}

async function scanIr(lang: IrLanguage, input: LanguageScanInput): Promise<LanguageScanResult | undefined> {
  const { rootDir, opts, diag } = input;
  const files = languageFiles(rootDir, lang.extensions, opts.include, [...lang.excludes, ...(opts.exclude ?? [])]);
  const leftOut = leftOutFiles({ dir: rootDir, include: opts.include, exclude: opts.exclude }, lang.extensions, lang.excludes, new Set(files));
  if (files.length === 0 && leftOut.length === 0) return undefined;
  const inScope = new Set(files);
  const all = [...new Set([...files, ...languageFiles(rootDir, lang.extensions, undefined, lang.excludes)])];
  const modules = await lowerAll(lang, all, inScope, rootDir, diag);
  const idx = new ProjectIndex(lang, modules);
  const scannable = modules.filter((m) => inScope.has(m.file));
  const selected = input.changed ? selectChanged(scannable, input.changed, idx) : scannable;
  if (!input.changed) for (const l of leftOut) diag.skip(l);
  const ctx: BuildIrCtx = {
    idx,
    envHints: readEnvHints(rootDir),
    rootDir,
    language: lang.id,
    sdkVersion: (file, pkg) => lang.manifests.version(file, pkg, rootDir),
  };
  const { raws, scanned } = detectAll(selected, ctx, input);
  const calls = buildAll(raws, ctx, diag);
  const selectedFiles = new Set(selected.map((m) => m.file));
  const changedFiles = input.changed ? files.filter((f) => input.changed!.has(f) || selectedFiles.has(f)).length : 0;
  return {
    calls,
    filesSeen: input.changed ? changedFiles : files.length + leftOut.length,
    filesScanned: scanned.length,
    coverage: input.changed ? [] : coverage(lang, rootDir, files, scanned, calls),
  };
}

/** A tree-sitter language as a scanner front end. */
export function irLanguage(lang: IrLanguage): LanguageFrontEnd {
  return { id: lang.id, ecosystem: lang.ecosystem, extensions: lang.extensions, scan: (input) => scanIr(lang, input) };
}
