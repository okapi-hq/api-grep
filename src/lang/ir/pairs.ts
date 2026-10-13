import { isSafeKey } from "../../record-keys.js";
import { addHeader, type HeadersResult } from "../../resolve/header-names.js";
import type { AuthScheme } from "../../types.js";
import { evaluate } from "./evaluate.js";
import type { ClientPart } from "../../report/schema.js";
import type { IrCtx, IrPair } from "./raw.js";
import { withSelf, withSubst } from "./raw.js";
import type { IrQuery } from "./request.js";
import { shapeOf } from "./shape.js";
import { staticKey } from "./values.js";

/** Query parameters that carry an API key (`?api-key=...`, `?key=...`) when an interceptor or a builder step sets them. */
const APIKEY_QUERY = new Set(["api-key", "apikey", "api_key", "key", "access_key", "token", "access_token", "auth_token"]);

export interface PairsResult {
  clientParts: ClientPart[];
  /** An API key sent as a query parameter. */
  queryAuth?: AuthScheme;
}

function addQuery(q: IrQuery, p: IrPair, key: string, ctx: IrCtx): void {
  if (!q.names.includes(key)) q.names.push(key);
  if (!p.value) {
    q.shape[key] = { type: "string" };
    return;
  }
  const r = shapeOf(p.value.expr, p.value.fn, ctx, 1);
  q.shape[key] = r.shape;
  if (!r.fromLiteral) q.dynamic.push({ where: "query", name: key, origin: r.origin ?? "unknown", shape: r.shape });
}

/**
 * Pairs into the call's headers and query: a header's literal value and the auth scheme it implies, a query
 * parameter's shape. Those an interceptor or a client default adds are listed as `clientParts`.
 */
export function resolvePairs(pairs: IrPair[] | undefined, base: IrCtx, headers: HeadersResult, query: IrQuery): PairsResult {
  const out: PairsResult = { clientParts: [] };
  for (const p of pairs ?? []) {
    const ctx = withSelf(withSubst(base, p.subst), p.self);
    const key = staticKey(p.name.expr, p.name.fn, ctx);
    // a name the code computes, or one a report record cannot hold (`__proto__`): an unknown header or parameter
    if (key === undefined || !isSafeKey(key)) {
      if (p.where === "header") headers.known = false;
      continue;
    }
    if (p.where === "header") addHeader(headers, key, p.value ? evaluate(p.value.expr, p.value.fn, ctx) : undefined);
    else addQuery(query, p, key, ctx);
    if (p.where === "query" && APIKEY_QUERY.has(key.toLowerCase())) out.queryAuth = "apikey";
    const name = p.where === "header" ? key.toLowerCase() : key;
    if (p.from && !out.clientParts.some((c) => c.where === p.where && c.name === name)) out.clientParts.push({ where: p.where, name, from: p.from });
  }
  if (!headers.known && headers.authScheme === "none") headers.authScheme = "unknown";
  return out;
}
