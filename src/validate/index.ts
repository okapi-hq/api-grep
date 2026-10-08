import type { Call } from "../report/schema.js";
import { checkShape } from "./check.js";
import { matchOperation } from "./match.js";
import { SpecStore, type LoadedSpec } from "./spec-loader.js";

export interface ValidateOptions {
  specsDir: string;
  validate: boolean;
  onWarning?: (message: string) => void;
}

/** Attaches operationId (spec match) and, with --validate, deterministic findings. Mutates calls in place. */
export async function applySpecs(calls: Call[], opts: ValidateOptions): Promise<void> {
  const store = new SpecStore(opts.specsDir, opts.onWarning);
  for (const call of calls) {
    if (call.provider === "internal" || call.provider === "unknown" || call.provider.startsWith("env:")) continue;
    const spec = await store.load(call.provider);
    if (!spec) continue;
    try {
      applySpec(call, spec, opts.validate);
    } catch (err) {
      opts.onWarning?.(`no spec check for call at ${call.location.file}:${call.location.line}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function applySpec(call: Call, spec: LoadedSpec, validate: boolean): void {
  const op = matchOperation(spec, call.method, call.pathTemplate);
  if (!op) return;
  call.operationId = call.operationId ?? op.operationId;
  call.confidence = Math.min(1, Math.round((call.confidence + 0.1) * 100) / 100);
  if (validate) call.findings = checkShape(call.body, op.requestSchema, op.ref);
}
