import { ts, type Node, type SourceFile } from "ts-morph";
import { buildCall, type BuildCtx } from "../../build-call.js";
import { detectFile } from "../../detect/index.js";
import { defaultRegistry, type Registry } from "../../detect/registry/index.js";
import { selectChanged } from "../../git.js";
import { relativePosix } from "../../files.js";
import { PackageJsonReader } from "../../package-json.js";
import { loadProject, TS_EXTENSIONS, tsFiles, type Loaded } from "../../project.js";
import type { DiagnosticsCollector } from "../../report/diagnostics.js";
import type { Call } from "../../report/schema.js";
import type { RawCall } from "../../types.js";
import { expandWrappers } from "../../wrappers/detect.js";
import { errorText } from "../files.js";
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

/** The files this scan covers; what it leaves out (unreadable, or removed by the options) goes to diagnostics. */
function filesInScope(loaded: Loaded, input: LanguageScanInput): { files: SourceFile[]; seen: number } {
  const parseError = (u: Loaded["unreadable"][number]): void => input.diag.skip({ file: u.file, reason: "parse-error", detail: u.detail });
  if (input.changed) {
    const changed = input.changed;
    const unreadable = loaded.unreadable.filter((u) => changed.has(u.path));
    unreadable.forEach(parseError);
    const files = selectChanged(loaded.files, changed);
    return { files, seen: files.length + unreadable.length };
  }
  loaded.unreadable.forEach(parseError);
  for (const l of loaded.leftOut) input.diag.skip(l);
  return { files: loaded.files, seen: loaded.files.length + loaded.leftOut.length + loaded.unreadable.length };
}

function scanTypeScript(input: LanguageScanInput): LanguageScanResult | undefined {
  const { rootDir, opts, diag } = input;
  // a directory without TypeScript (a Python repository) never pays for a ts-morph Project
  if (tsFiles(rootDir, undefined).length === 0) return undefined;
  const registry = opts.registry ?? defaultRegistry();
  const loaded = loadProject({ dir: rootDir, tsconfig: opts.tsconfig, include: opts.include, exclude: opts.exclude });
  const { files, seen } = filesInScope(loaded, input);
  const { raws, scanned } = detectAll(files, registry, input);
  const packages = new PackageJsonReader(rootDir);
  const ctx: BuildCtx = { rootDir, envHints: loaded.envHints, sdkVersion: (file, name) => packages.versionOf(file, name) };
  const calls = buildAll(raws, ctx, diag);
  // a --changed-since scan sees a few files: their imports say nothing about the repo's SDKs
  const coverage = input.changed ? [] : sdkCoverage(rootDir, scanned, calls, registry, packages).sdks;
  return { calls, filesSeen: seen, filesScanned: scanned.length, coverage };
}

export const typescript: LanguageFrontEnd = { id: "typescript", ecosystem: "npm", extensions: TS_EXTENSIONS, scan: (input) => Promise.resolve(scanTypeScript(input)) };
