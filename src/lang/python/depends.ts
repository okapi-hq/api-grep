import { valueChain } from "../ir/chain.js";
import type { IrInjection, Scoped } from "../ir/language.js";
import type { CallExpr, Expr, FunctionDef, Param } from "../ir/model.js";
import type { IrCtx } from "../ir/raw.js";
import { boltListenerParam } from "./slack-bolt.js";

/** FastAPI's dependency markers: a parameter defaulting to one gets what the dependency returns. */
const MARKERS = new Set(["fastapi.Depends", "fastapi.Security", "fastapi.params.Depends", "fastapi.params.Security"]);

function marker(e: Expr | undefined, fn: FunctionDef, ctx: IrCtx): CallExpr | undefined {
  if (e?.k !== "call") return undefined;
  const c = valueChain(e.fn, fn, ctx);
  return c.root.kind === "external" && MARKERS.has(c.segs.map((s) => s.name).join(".")) ? e : undefined;
}

/**
 * `client: OpenAI = Depends(get_client)`: what the dependency returns, or yields (`yield client` in a generator
 * dependency); `Depends()` with no dependency builds the annotated class.
 */
function dependency(p: Param, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  const dep = marker(p.default, fn, ctx);
  if (!dep) return undefined;
  const given = dep.args.find((a) => !a.spread && (!a.name || a.name === "dependency"))?.value ?? p.type;
  if (!given) return undefined;
  const target = valueChain(given, fn, ctx);
  const yielded = target.root.kind === "function" && target.segs.length === 0 && target.root.fn.returns.length === 0 ? target.root.fn.yields?.[0] : undefined;
  if (yielded && target.root.kind === "function") return { expr: yielded, fn: target.root.fn };
  return { expr: { k: "call", fn: given, args: [], pos: dep.pos }, fn };
}

/** What FastAPI injects into a route's or a dependency's parameters, and slack_bolt into a listener's. */
export const PYTHON_INJECTION: IrInjection = {
  param: (p, fn, ctx) => dependency(p, fn, ctx) ?? boltListenerParam(p, fn, ctx),
  field: () => undefined,
  call: () => undefined,
};
