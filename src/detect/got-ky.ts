import { Node, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import type { Callee, EvalCtx, RawCall } from "../types.js";
import { exportedChain } from "./callee.js";
import { getProp, toObjectLiteral } from "./options.js";

const VERBS = new Set(["get", "post", "put", "patch", "head", "delete"]);
const PKGS: Record<string, RawCall["client"]> = { got: "got", ky: "ky", "ky-universal": "ky" };

function instanceOptions(callee: Callee): Expression | undefined {
  const inst = callee.instance;
  if (!inst || inst.kind !== "call") return undefined;
  const last = inst.chain[inst.chain.length - 1];
  return last === "extend" || last === "create" ? inst.args[0] : undefined;
}

function pickBody(opts: Expression | undefined, ctx: EvalCtx): Pick<RawCall, "bodyExpr" | "bodyKey"> {
  const json = getProp(opts, "json", ctx);
  if (json) return { bodyExpr: json, bodyKey: "json" };
  const form = getProp(opts, "form", ctx);
  if (form) return { bodyExpr: form, bodyKey: "form" };
  const body = getProp(opts, "body", ctx);
  if (body) return { bodyExpr: body, bodyKey: "body" };
  return {};
}

export function detectGotKy(node: CallExpression | NewExpression, callee: Callee, ctx: EvalCtx = {}): RawCall | null {
  if (!Node.isCallExpression(node) || !callee.package) return null;
  const client = PKGS[callee.package];
  if (!client) return null;
  const ch = exportedChain(callee);
  const args = node.getArguments() as Expression[];
  let verb: string | undefined;
  if (ch.length === 1 && VERBS.has(ch[0]!)) verb = ch[0];
  else if (ch.length !== 0) return null;
  if (!verb && callee.importedName && callee.importedName !== "default" && callee.importedName !== "*" && !callee.instance) return null;
  const opts = args[1];
  const instOpts = instanceOptions(callee);
  const raw: RawCall = {
    node,
    client,
    urlExpr: args[0],
    baseUrlExpr: getProp(opts, "prefixUrl", ctx) ?? getProp(instOpts, "prefixUrl", ctx),
    impliedMethod: verb?.toUpperCase(),
    methodExpr: verb ? undefined : getProp(opts, "method", ctx),
    queryExpr: getProp(opts, "searchParams", ctx),
    headersExpr: getProp(opts, "headers", ctx),
    instanceHeadersExpr: getProp(instOpts, "headers", ctx),
    optionsExpr: opts,
    ...pickBody(opts, ctx),
  };
  if (opts && !toObjectLiteral(opts, ctx)) raw.optionsOpaque = true;
  return raw;
}
