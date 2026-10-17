import { Node, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import type { Callee, EvalCtx, RawCall } from "../types.js";
import { constructedName, isStringLike, unwrap } from "../ast/expr.js";
import { getProp, toObjectLiteral } from "../ast/object.js";
import { exportedChain } from "./callee.js";

const PKGS = new Set(["http", "https"]);

function stringTyped(e: Expression): boolean {
  try {
    const t = e.getType();
    return t.isString() || t.isStringLiteral() || t.isTemplateLiteral() || t.getSymbol()?.getName() === "URL";
  } catch {
    return false;
  }
}

/**
 * `request(url, options?, cb?)` or `request(options, cb?)`: the first argument is the URL when it is a string or a `URL`,
 * by syntax or type, or when an options object follows it (`https.request(url, { method }, cb)` in a wrapper whose `url`
 * parameter has no type); one that reads as an object is the options.
 */
function urlFirst(args: Expression[], ctx: EvalCtx): boolean {
  const first = args[0] ? unwrap(args[0]) : undefined;
  if (!first) return false;
  if (isStringLike(first) || constructedName(first) === "URL") return true;
  if (Node.isObjectLiteralExpression(first) || toObjectLiteral(first, ctx)) return false;
  return stringTyped(first) || (!!args[1] && !!toObjectLiteral(args[1], ctx));
}

export function detectNodeHttp(node: CallExpression | NewExpression, callee: Callee, ctx: EvalCtx = {}): RawCall | null {
  if (!Node.isCallExpression(node) || !callee.package || !PKGS.has(callee.package)) return null;
  const ch = exportedChain(callee);
  if (ch.length !== 1 || (ch[0] !== "request" && ch[0] !== "get")) return null;
  const args = node.getArguments() as Expression[];
  const withUrl = urlFirst(args, ctx);
  const opts = withUrl ? args[1] : args[0];
  const raw: RawCall = {
    node,
    client: "node-http",
    urlExpr: withUrl ? args[0] : undefined,
    impliedMethod: ch[0] === "get" ? "GET" : undefined,
    methodExpr: getProp(opts, "method", ctx),
    headersExpr: getProp(opts, "headers", ctx),
    optionsExpr: opts,
  };
  if (!withUrl) {
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
