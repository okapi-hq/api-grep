import { Node, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import { evaluate, staticText } from "../resolve/evaluate.js";
import type { AuthScheme, Callee, EvalCtx, FrameworkEntry, FrameworkKeys, RawCall } from "../types.js";
import { exportedChain } from "./callee.js";
import { getProp, toObjectLiteral } from "./options.js";

const DEFAULT_KEYS: Required<Omit<FrameworkKeys, "auth">> = {
  method: "method",
  url: ["url", "uri"],
  baseUrl: ["baseURL"],
  body: ["body", "form", "formData"],
  query: ["qs", "params", "searchParams"],
  headers: ["headers"],
};

const AUTH_TYPES: Record<string, AuthScheme> = { BEARER_TOKEN: "bearer", bearer: "bearer", BASIC: "basic", basic: "basic" };

function sameChain(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function matches(entry: FrameworkEntry, callee: Callee, chain: string[]): boolean {
  const m = entry.match;
  if (m.package) return callee.package === m.package && !callee.instance && sameChain(chain, m.chain);
  if (m.this) {
    if (callee.thisRoot && !callee.package && sameChain(chain, m.chain)) return true;
    if (callee.package && m.packages?.includes(callee.package) && sameChain(chain, m.chain.slice(1))) return true;
  }
  return false;
}

function firstProp(opts: Expression | undefined, names: string[] | undefined, ctx: EvalCtx): { key?: string; expr?: Expression } {
  for (const name of names ?? []) {
    const e = getProp(opts, name, ctx);
    if (e) return { key: name, expr: e };
  }
  return {};
}

function bodyOf(opts: Expression | undefined, keys: FrameworkKeys, ctx: EvalCtx): Pick<RawCall, "bodyExpr" | "bodyKey" | "encoding"> {
  const { key, expr } = firstProp(opts, keys.body, ctx);
  if (!expr) return {};
  if (key === "form") return { bodyExpr: expr, bodyKey: "form" };
  if (key === "json") return { bodyExpr: expr, bodyKey: "json" };
  if (key === "formData") return { bodyExpr: expr, bodyKey: "body", encoding: "multipart" };
  return { bodyExpr: expr, bodyKey: "body" };
}

/** `authentication: { type: AuthenticationType.BEARER_TOKEN }` style hints. */
function authOf(opts: Expression | undefined, key: string | undefined, ctx: EvalCtx): AuthScheme | undefined {
  if (!key) return undefined;
  const auth = getProp(opts, key, ctx);
  const type = getProp(auth, "type", ctx);
  if (!type) return auth ? "unknown" : undefined;
  const text = staticText(evaluate(type, ctx));
  return text ? (AUTH_TYPES[text] ?? "unknown") : "unknown";
}

function buildRaw(node: CallExpression, entry: FrameworkEntry, opts: Expression | undefined, ctx: EvalCtx): RawCall {
  const keys: FrameworkKeys = { ...DEFAULT_KEYS, ...entry.keys };
  const raw: RawCall = {
    node,
    client: "framework",
    framework: entry.name,
    urlExpr: firstProp(opts, keys.url, ctx).expr,
    baseUrlExpr: firstProp(opts, keys.baseUrl, ctx).expr,
    impliedMethod: entry.method,
    methodExpr: entry.method || !keys.method ? undefined : getProp(opts, keys.method, ctx),
    queryExpr: firstProp(opts, keys.query, ctx).expr,
    headersExpr: firstProp(opts, keys.headers, ctx).expr,
    optionsExpr: opts,
    authHint: authOf(opts, keys.auth, ctx),
    ...(entry.encoding ? { encoding: entry.encoding } : {}),
    ...bodyOf(opts, keys, ctx),
  };
  if (!opts || !toObjectLiteral(opts, ctx)) raw.optionsOpaque = true;
  return raw;
}

/** Framework-specific HTTP helpers that take one options object (n8n `this.helpers.*`, activepieces `httpClient`, ai-sdk `postJsonToApi`). */
export function detectFramework(node: CallExpression | NewExpression, callee: Callee, frameworks: FrameworkEntry[], ctx: EvalCtx = {}): RawCall | null {
  if (!Node.isCallExpression(node) || frameworks.length === 0) return null;
  let chain = callee.package && !callee.viaType ? exportedChain(callee) : callee.chain;
  let shift = 0;
  if (chain[chain.length - 1] === "call") {
    chain = chain.slice(0, -1);
    shift = 1;
  }
  const args = node.getArguments() as Expression[];
  for (const entry of frameworks) {
    if (!matches(entry, callee, chain)) continue;
    return buildRaw(node, entry, args[entry.optionsArg + shift], ctx);
  }
  return null;
}
