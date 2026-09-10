import { Node, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import type { Callee, EvalCtx, RawCall } from "../types.js";
import { exportedChain, unwrap } from "./callee.js";
import { getProp, isStringLike, toObjectLiteral } from "./options.js";

const PKGS = new Set(["http", "https"]);

export function detectNodeHttp(node: CallExpression | NewExpression, callee: Callee, ctx: EvalCtx = {}): RawCall | null {
  if (!Node.isCallExpression(node) || !callee.package || !PKGS.has(callee.package)) return null;
  const ch = exportedChain(callee);
  if (ch.length !== 1 || (ch[0] !== "request" && ch[0] !== "get")) return null;
  const args = node.getArguments() as Expression[];
  const first = args[0] ? unwrap(args[0]) : undefined;
  const urlFirst = first && (isStringLike(first) || (Node.isNewExpression(first) && first.getExpression().getText() === "URL"));
  const opts = urlFirst ? args[1] : args[0];
  const raw: RawCall = {
    node,
    client: "node-http",
    urlExpr: urlFirst ? args[0] : undefined,
    impliedMethod: ch[0] === "get" ? "GET" : undefined,
    methodExpr: getProp(opts, "method", ctx),
    headersExpr: getProp(opts, "headers", ctx),
    optionsExpr: opts,
  };
  if (!urlFirst) {
    raw.nodeOpts = {
      scheme: callee.package,
      hostExpr: getProp(opts, "hostname", ctx) ?? getProp(opts, "host", ctx),
      portExpr: getProp(opts, "port", ctx),
      pathExpr: getProp(opts, "path", ctx),
    };
  }
  if (opts && !toObjectLiteral(opts, ctx)) raw.optionsOpaque = true;
  return raw;
}
