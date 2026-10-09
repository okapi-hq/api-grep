import type { Expression } from "ts-morph";
import type { DynamicPart, EvalCtx } from "../types.js";
import { evaluate, staticText } from "./evaluate.js";

export interface MethodResult {
  method: string;
  dynamic?: DynamicPart;
}

/** HTTP methods are tokens (`POST`, `PROPFIND`, `M-SEARCH`); a literal that is not one is not a method the scan can report. */
const METHOD_RE = /^[A-Za-z][A-Za-z-]*$/;

export function resolveMethod(implied: string | undefined, expr: Expression | undefined, ctx: EvalCtx = {}): MethodResult {
  if (implied) return { method: implied.toUpperCase() };
  if (!expr) return { method: "GET" };
  const parts = evaluate(expr, ctx);
  const text = staticText(parts)?.trim();
  if (text !== undefined) {
    if (text === "") return { method: "GET" };
    return METHOD_RE.test(text) ? { method: text.toUpperCase() } : { method: "DYNAMIC", dynamic: { where: "method", name: "method", origin: "unknown" } };
  }
  const dyn = parts.find((p): p is Exclude<typeof p, { kind: "static" }> => p.kind !== "static");
  const name = dyn ? dyn.name : "method";
  const origin = !dyn ? "unknown" : dyn.kind === "env" ? "env" : dyn.origin;
  return { method: "DYNAMIC", dynamic: { where: "method", name, origin } };
}
