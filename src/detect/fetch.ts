import { Node, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import type { Callee, EvalCtx, RawCall } from "../types.js";
import { exportedChain, unwrap } from "./callee.js";
import { getProp, toObjectLiteral } from "./options.js";
import { writtenType } from "./type-annotation.js";

const FETCH_PKGS = new Set(["node-fetch", "cross-fetch", "isomorphic-fetch", "isomorphic-unfetch", "unfetch", "whatwg-fetch", "undici", "@whatwg-node/fetch", "ofetch"]);
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self"]);

function isFetchCallee(c: Callee): boolean {
  if (c.instance) return false;
  if (c.global === "fetch" && c.chain.length === 0) return true;
  if (c.global && GLOBAL_OBJECTS.has(c.global) && c.chain.length === 1 && c.chain[0] === "fetch") return true;
  if (c.package && FETCH_PKGS.has(c.package)) {
    const ch = exportedChain(c);
    if (c.package === "undici") return ch.length === 1 && ch[0] === "fetch";
    if (c.package === "ofetch") return ch.length <= 1 && (ch[0] === undefined || ch[0] === "ofetch" || ch[0] === "$fetch");
    return ch.length === 0 || (ch.length === 1 && (ch[0] === "fetch" || ch[0] === "default"));
  }
  return false;
}

/** fetch(url, init) / fetch(new Request(url, init)). */
export function fromFetchArgs(node: CallExpression, args: Expression[], ctx: EvalCtx = {}, client: RawCall["client"] = "fetch"): RawCall {
  let urlExpr = args[0];
  let options = args[1];
  const u = urlExpr ? unwrap(urlExpr) : undefined;
  if (u && Node.isNewExpression(u) && u.getExpression().getText() === "Request") {
    const [ru, ro] = u.getArguments() as Expression[];
    urlExpr = ru;
    options = options ?? ro;
  }
  const raw: RawCall = { node, client, urlExpr, optionsExpr: options };
  if (options) {
    raw.methodExpr = getProp(options, "method", ctx);
    raw.bodyExpr = getProp(options, "body", ctx);
    raw.headersExpr = getProp(options, "headers", ctx);
    raw.bodyKey = "body";
    if (!toObjectLiteral(options, ctx)) raw.optionsOpaque = true;
  }
  return raw;
}

const TYPEOF_FETCH = /^typeof\s+(?:globalThis\.|window\.|self\.)?fetch$/;

/** `fetchImpl: typeof fetch` received from outside: whatever it is, it takes fetch's arguments. */
function declaredAsFetch(node: CallExpression): boolean {
  const expr = unwrap(node.getExpression() as Expression);
  return (Node.isIdentifier(expr) || Node.isPropertyAccessExpression(expr)) && TYPEOF_FETCH.test(writtenType(expr).trim());
}

export function detectFetch(node: CallExpression | NewExpression, callee: Callee, ctx: EvalCtx = {}): RawCall | null {
  if (!Node.isCallExpression(node) || !(isFetchCallee(callee) || declaredAsFetch(node))) return null;
  return fromFetchArgs(node, node.getArguments() as Expression[], ctx);
}
