import { ts, type Node, type SourceFile } from "ts-morph";
import { buildCall, type BuildCtx } from "../../build-call.js";
import { detectFile } from "../../detect/index.js";
import type { ReceiverResolver } from "../../detect/receiver.js";
import type { Registry } from "../../detect/registry/index.js";
import { relativePosix } from "../../files.js";
import { limitDiagnostics } from "../../operation/limits.js";
import { tableDiagnostics } from "../../resolve/choice.js";
import type { Call } from "../../report/schema.js";
import type { RawCall } from "../../types.js";
import { expandWrappers } from "../../wrappers/detect.js";
import { errorText } from "../files.js";
import { relieve } from "./checker-budget.js";
import type { DiagnosticsSink } from "./deferred.js";

/** Why a file cannot be read reliably: a syntax error, or an import whose module specifier is not a string literal. */
function parseProblem(sf: SourceFile): string | undefined {
  const syntax = sf.getProject().getProgram().compilerObject.getSyntacticDiagnostics(sf.compilerNode)[0];
  if (syntax) return ts.flattenDiagnosticMessageText(syntax.messageText, " ");
  const decls = [...sf.getImportDeclarations(), ...sf.getExportDeclarations()];
  const bad = decls.some((d) => d.compilerNode.moduleSpecifier !== undefined && !ts.isStringLiteral(d.compilerNode.moduleSpecifier));
  return bad ? "Expected the module specifier to be a string literal." : undefined;
}

export function lineOf(node: Node): number {
  return node.getSourceFile().getLineAndColumnAtPos(node.getStart()).line;
}

export interface DetectCtx {
  rootDir: string;
  registry: Registry;
  receivers: ReceiverResolver;
  wrappers: boolean;
  diag: DiagnosticsSink;
}

export interface Detected {
  raws: RawCall[];
  scanned: SourceFile[];
}

/** Runs every detector on each file; a file that cannot be read or makes a detector throw is skipped, not fatal. */
export function detectAll(files: SourceFile[], ctx: DetectCtx): Detected {
  const raws: RawCall[] = [];
  const scanned: SourceFile[] = [];
  const { registry, receivers, diag } = ctx;
  for (const sf of files) {
    const file = relativePosix(ctx.rootDir, sf.getFilePath());
    try {
      const problem = parseProblem(sf);
      if (problem) {
        diag.skip({ file, reason: "parse-error", detail: problem });
        continue;
      }
      const { calls, candidates, unfollowed } = detectFile(sf, registry, sf, receivers);
      const expanded = ctx.wrappers ? expandWrappers(candidates, registry, receivers) : { calls: [], unfollowed: [] };
      raws.push(...calls, ...expanded.calls);
      for (const u of [...unfollowed, ...expanded.unfollowed]) diag.unfollow({ file, line: lineOf(u.node), reason: u.reason, expr: u.expr, via: u.via });
      scanned.push(sf);
    } catch (err) {
      diag.skip({ file, reason: "internal-error", detail: errorText(err) });
    }
    relieve(sf.getProject());
  }
  return { raws, scanned };
}

export function buildAll(raws: RawCall[], ctx: BuildCtx, diag: DiagnosticsSink): Call[] {
  const calls: Call[] = [];
  for (const raw of raws) {
    try {
      const built = buildCall(raw, ctx);
      calls.push(...built);
      for (const u of [...limitDiagnostics(built), ...tableDiagnostics(built)]) diag.unfollow(u);
    } catch (err) {
      diag.drop({ file: relativePosix(ctx.rootDir, raw.node.getSourceFile().getFilePath()), line: lineOf(raw.node), reason: "internal-error", detail: errorText(err) });
    }
    relieve(raw.node.getProject());
  }
  return calls;
}
