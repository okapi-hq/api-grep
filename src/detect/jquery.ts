import { Node, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import { getProp, toObjectLiteral } from "../ast/object.js";
import { evaluate, staticText } from "../resolve/evaluate.js";
import type { Callee, EvalCtx, RawCall } from "../types.js";
import { exportedChain } from "./callee.js";

const VERBS: Record<string, string | undefined> = { ajax: undefined, get: "GET", getJSON: "GET", post: "POST" };

const isJquery = (c: Callee): boolean => c.package === "jquery" || c.global === "$" || c.global === "jQuery";

/** A function argument (`$.get(url, data, success)`'s callback) is not data. */
function dataArg(e: Expression | undefined): Expression | undefined {
  const u = e ? unwrap(e) : undefined;
  return u && !Node.isArrowFunction(u) && !Node.isFunctionExpression(u) ? e : undefined;
}

/** `$.ajax(settings)`, `$.ajax(url, settings)` and the object forms of `$.get` / `$.post`. */
function settingsOf(verb: string, args: Expression[], ctx: EvalCtx): { url?: Expression; settings?: Expression } {
  const first = args[0];
  if (first && toObjectLiteral(first, ctx)) return { url: getProp(first, "url", ctx), settings: first };
  return { url: first, settings: verb === "ajax" ? args[1] : undefined };
}

/**
 * jQuery: `$.ajax({ url, type, data, contentType, headers })`, `$.get(url, data)`, `$.getJSON(url, data)`,
 * `$.post(url, data)`. jQuery sends `data` as the query string of a GET and as a form body otherwise, unless
 * `contentType` says JSON.
 */
export function detectJquery(node: CallExpression | NewExpression, callee: Callee, ctx: EvalCtx = {}): RawCall | null {
  if (!Node.isCallExpression(node) || !isJquery(callee) || callee.instance) return null;
  const ch = exportedChain(callee);
  const verb = ch.length === 1 && ch[0]! in VERBS ? ch[0]! : undefined;
  if (!verb) return null;
  const args = node.getArguments() as Expression[];
  const { url, settings } = settingsOf(verb, args, ctx);
  const methodExpr = getProp(settings, "method", ctx) ?? getProp(settings, "type", ctx);
  const method = VERBS[verb] ?? (methodExpr ? staticText(evaluate(methodExpr, ctx))?.toUpperCase() : "GET");
  const data = getProp(settings, "data", ctx) ?? (settings === args[0] ? undefined : dataArg(args[1]));
  const contentType = getProp(settings, "contentType", ctx);
  const json = !!contentType && /json/i.test(staticText(evaluate(contentType, ctx)) ?? "");
  const inQuery = method === "GET" || method === "HEAD";
  return {
    node,
    client: "jquery",
    urlExpr: url,
    methodExpr: VERBS[verb] ? undefined : methodExpr,
    impliedMethod: VERBS[verb] ?? (methodExpr ? undefined : "GET"),
    ...(inQuery ? { queryExpr: data } : { bodyExpr: data, bodyKey: "form" as const }),
    ...(json ? { encoding: "json" as const } : {}),
    headersExpr: getProp(settings, "headers", ctx),
    optionsExpr: settings,
  };
}
