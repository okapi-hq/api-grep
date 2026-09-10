import type { Expression } from "ts-morph";
import type { DynamicPart, EvalCtx } from "../types.js";
import { evaluate, staticText } from "./evaluate.js";

export interface MethodResult {
  method: string;
  dynamic?: DynamicPart;
}

export function resolveMethod(implied: string | undefined, expr: Expression | undefined, ctx: EvalCtx = {}): MethodResult {
  if (implied) return { method: implied.toUpperCase() };
  if (!expr) return { method: "GET" };
  const parts = evaluate(expr, ctx);
  const text = staticText(parts);
  if (text !== undefined) return { method: text.toUpperCase() || "GET" };
  const dyn = parts.find((p): p is Exclude<typeof p, { kind: "static" }> => p.kind !== "static");
  const name = dyn ? dyn.name : "method";
  const origin = !dyn ? "unknown" : dyn.kind === "env" ? "env" : dyn.origin;
  return { method: "DYNAMIC", dynamic: { where: "method", name, origin } };
}
