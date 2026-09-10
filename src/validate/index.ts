import type { Call } from "../report/schema.js";
import type { Shape } from "../types.js";
import { checkShape } from "./check.js";
import { matchOperation } from "./match.js";
import { SpecStore } from "./spec-loader.js";

export interface ValidateOptions {
  specsDir: string;
  validate: boolean;
}

/** Attaches operationId (spec match) and, with --validate, deterministic findings. Mutates calls in place. */
export async function applySpecs(calls: Call[], opts: ValidateOptions): Promise<void> {
  const store = new SpecStore(opts.specsDir);
  for (const call of calls) {
    if (call.provider === "internal" || call.provider === "unknown" || call.provider.startsWith("env:")) continue;
    const spec = await store.load(call.provider);
    if (!spec) continue;
    const op = matchOperation(spec, call.method, call.pathTemplate);
    if (!op) continue;
    call.operationId = call.operationId ?? op.operationId;
    call.confidence = Math.min(1, Math.round((call.confidence + 0.1) * 100) / 100);
    if (opts.validate) call.findings = checkShape(call.body as Shape | undefined, op.requestSchema, op.ref);
  }
}
