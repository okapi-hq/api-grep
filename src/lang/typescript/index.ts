import type { Node, SourceFile } from "ts-morph";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildCall, type BuildCtx } from "../../build-call.js";
import { detectFile } from "../../detect/index.js";
import { defaultRegistry, type Registry } from "../../detect/registry/index.js";
import { selectChanged } from "../../git.js";
import { loadProject, TS_EXTENSIONS, tsFiles, unreadable } from "../../project.js";
import type { DiagnosticsCollector } from "../../report/diagnostics.js";
import type { Call } from "../../report/schema.js";
import type { RawCall } from "../../types.js";
import { expandWrappers } from "../../wrappers/detect.js";
import { errorText, relPath } from "../files.js";
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

async function scanTypeScript(input: LanguageScanInput): Promise<LanguageScanResult | undefined> {
  const { rootDir, opts, diag } = input;
  // a directory without TypeScript (a Python repository) never pays for a ts-morph Project
  if (tsFiles(rootDir, undefined).length === 0) return undefined;
  const registry = opts.registry ?? defaultRegistry();
  const loaded = loadProject({ dir: rootDir, tsconfig: opts.tsconfig, include: opts.include, exclude: opts.exclude });
  let files = loaded.files;
  if (input.changed) files = selectChanged(files, input.changed);
  else for (const l of loaded.leftOut) diag.skip(l);
  const { raws, scanned } = detectAll(files, registry, input);
  const calls = buildAll(raws, { rootDir, envHints: loaded.envHints, sdkVersion: sdkVersionLookup(rootDir) }, diag);
  const filesSeen = input.changed ? files.length : files.length + loaded.leftOut.length;
  // a --changed-since scan sees a few files: their imports say nothing about the repo's SDKs
  const coverage = input.changed ? [] : sdkCoverage(rootDir, scanned, calls, registry).sdks;
  return { calls, filesSeen, filesScanned: scanned.length, coverage };
}

export const typescript: LanguageFrontEnd = { id: "typescript", ecosystem: "npm", extensions: TS_EXTENSIONS, scan: scanTypeScript };
