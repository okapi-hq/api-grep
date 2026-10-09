import { Node, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import type { Callee, EvalCtx, RawCall } from "../types.js";
import { isStringLike, unwrap } from "../ast/expr.js";
import { getProp, toObjectLiteral } from "../ast/object.js";
import { exportedChain, factoryOptions, isNamedImport } from "./callee.js";

const VERBS = new Set(["get", "delete", "head", "options", "post", "put", "patch"]);
const WITH_BODY = new Set(["post", "put", "patch"]);

function instanceConfig(callee: Callee): Expression | undefined {
  return factoryOptions(callee, ["create"]);
}

function fromConfig(node: CallExpression, cfg: Expression | undefined, callee: Callee, ctx: EvalCtx): RawCall {
  const instCfg = instanceConfig(callee);
  const raw: RawCall = {
    node,
    client: "axios",
    urlExpr: getProp(cfg, "url", ctx),
    baseUrlExpr: getProp(cfg, "baseURL", ctx) ?? getProp(instCfg, "baseURL", ctx),
    methodExpr: getProp(cfg, "method", ctx),
    bodyExpr: getProp(cfg, "data", ctx),
    bodyKey: "data",
    queryExpr: getProp(cfg, "params", ctx),
    headersExpr: getProp(cfg, "headers", ctx),
    instanceHeadersExpr: getProp(instCfg, "headers", ctx),
    optionsExpr: cfg,
  };
  if (cfg && !toObjectLiteral(cfg, ctx)) raw.optionsOpaque = true;
  return raw;
}

function fromVerb(node: CallExpression, verb: string, args: Expression[], callee: Callee, ctx: EvalCtx): RawCall {
  const hasBody = WITH_BODY.has(verb);
  const cfg = hasBody ? args[2] : args[1];
  const instCfg = instanceConfig(callee);
  return {
    node,
    client: "axios",
    urlExpr: args[0],
    baseUrlExpr: getProp(cfg, "baseURL", ctx) ?? getProp(instCfg, "baseURL", ctx),
    impliedMethod: verb.toUpperCase(),
    bodyExpr: hasBody ? args[1] : getProp(cfg, "data", ctx),
    bodyKey: "data",
    queryExpr: getProp(cfg, "params", ctx),
    headersExpr: getProp(cfg, "headers", ctx),
    instanceHeadersExpr: getProp(instCfg, "headers", ctx),
    optionsExpr: cfg,
  };
}

/** A string (`"https://..."`, `BASE + id`, a `string` variable) or a `URL` as the first argument. */
function urlFirst(arg: Expression): boolean {
  if (isStringLike(arg)) return true;
  try {
    const t = unwrap(arg).getType();
    return t.isString() || t.isStringLiteral() || t.isTemplateLiteral() || t.getSymbol()?.getName() === "URL";
  } catch {
    return false;
  }
}

export function detectAxios(node: CallExpression | NewExpression, callee: Callee, ctx: EvalCtx = {}): RawCall | null {
  if (!Node.isCallExpression(node) || callee.package !== "axios") return null;
  const ch = exportedChain(callee);
  const args = node.getArguments() as Expression[];
  if (ch.length === 0 || (ch.length === 1 && ch[0] === "request")) {
    if (!callee.instance && ch.length === 0 && isNamedImport(callee)) return null;
    // `axios(url, config)`: the URL first, the config second
    if (ch.length === 0 && args[0] && !toObjectLiteral(args[0], ctx) && urlFirst(args[0])) return { ...fromConfig(node, args[1], callee, ctx), urlExpr: args[0] };
    return fromConfig(node, args[0], callee, ctx);
  }
  if (ch.length === 1 && VERBS.has(ch[0]!)) return fromVerb(node, ch[0]!, args, callee, ctx);
  return null;
}
