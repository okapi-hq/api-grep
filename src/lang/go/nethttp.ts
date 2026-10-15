import { staticText } from "../../resolve/parts.js";
import type { AuthScheme, BodyEncoding } from "../../types.js";
import type { Chain } from "../ir/chain.js";
import { evaluate } from "../ir/evaluate.js";
import type { Scoped } from "../ir/language.js";
import type { CallExpr, Expr, FunctionDef } from "../ir/model.js";
import type { IrCtx, IrPair, IrRaw } from "../ir/raw.js";
import { rootLength } from "../ir/sdk.js";
import { importRoot } from "./names.js";

/**
 * `net/http` requests built with `http.NewRequest(method, url, body)` / `http.NewRequestWithContext(ctx, ...)` (also
 * with fhttp and go-retryablehttp, which keep its API), reported
 * where they are built: the request can be sent by any client (`client.Do(req)`, `http.DefaultClient.Do`, a retrying
 * wrapper), while the method, URL and body are all here. The headers, basic auth and query parameters the function then
 * sets on the request variable (`req.Header.Set(k, v)`, `req.SetBasicAuth(u, p)`, `q := req.URL.Query(); q.Set(k, v)`)
 * are the request's.
 */

const STARTS: Record<string, number> = { NewRequest: 0, NewRequestWithContext: 1 };

/** `net/http` and the packages with its request API: the fhttp fork, go-retryablehttp's wrapper. */
export const NET_HTTP = ["net/http", "github.com/bogdanfinn/fhttp", "github.com/hashicorp/go-retryablehttp"].map(importRoot);

const positional = (call: CallExpr, i: number, fn: FunctionDef): Scoped | undefined => {
  const a = call.args.filter((x) => !x.name && !x.spread)[i];
  return a ? { expr: a.value, fn } : undefined;
};

/** `name.method(...)` / `name.attr.method(...)` on the variable `target`, after the request is built. */
function callOn(c: CallExpr, target: string, path: string[], methods: string[], after: number): boolean {
  if (c.pos.offset < after || c.fn.k !== "attr" || !methods.includes(c.fn.name)) return false;
  let obj: Expr = c.fn.obj;
  for (const attr of [...path].reverse()) {
    if (obj.k !== "attr" || obj.name !== attr) return false;
    obj = obj.obj;
  }
  return obj.k === "name" && obj.name === target;
}

/** Variables holding `req.URL.Query()`: the query parameters set on them are the request's (`req.URL.RawQuery = q.Encode()`). */
function queryVars(fn: FunctionDef, target: string): Set<string> {
  const out = new Set<string>();
  for (const a of fn.assigns) {
    const v = a.value;
    if (v.k === "call" && v.args.length === 0 && callOn(v, target, ["URL"], ["Query"], 0)) out.add(a.target);
  }
  return out;
}

interface Steps {
  pairs: IrPair[];
  auth?: AuthScheme;
}

/** What the function sets on the request after building it. */
function steps(call: CallExpr, fn: FunctionDef): Steps {
  const target = fn.assigns.find((a) => a.value === call && !a.edit)?.target;
  const out: Steps = { pairs: [] };
  if (!target) return out;
  const queries = queryVars(fn, target);
  const after = call.pos.offset;
  for (const c of fn.calls) {
    const [name, value] = [positional(c, 0, fn), positional(c, 1, fn)];
    if (callOn(c, target, ["Header"], ["Set", "Add"], after) && name) out.pairs.push({ where: "header", name, value });
    else if (callOn(c, target, [], ["SetBasicAuth"], after)) out.auth = "basic";
    else if (name && [...queries].some((q) => callOn(c, q, [], ["Set", "Add"], after))) out.pairs.push({ where: "query", name, value });
  }
  return out;
}

const textOf = (s: Scoped | undefined, ctx: IrCtx): string | undefined => (s ? staticText(evaluate(s.expr, s.fn, ctx)) : undefined);

/** The encoding a literal `Content-Type` header names. */
function encodingOf(pairs: IrPair[], ctx: IrCtx): BodyEncoding | undefined {
  const type = pairs.find((p) => p.where === "header" && textOf(p.name, ctx)?.toLowerCase() === "content-type");
  const value = textOf(type?.value, ctx)?.toLowerCase() ?? "";
  if (value.includes("x-www-form-urlencoded")) return "form";
  if (value.startsWith("multipart/")) return "multipart";
  if (value.includes("json")) return "json";
  if (value.includes("xml")) return "xml";
  return value ? "raw" : undefined;
}

export function detectNewRequest(call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  const last = chain.segs.at(-1);
  if (chain.root.kind !== "external" || last?.call !== call || !Object.hasOwn(STARTS, last.name) || rootLength(chain.segs, NET_HTTP) !== chain.segs.length - 1) return undefined;
  const at = STARTS[last.name]!;
  const [method, url, body] = [positional(call, at, fn), positional(call, at + 1, fn), positional(call, at + 2, fn)];
  const { pairs, auth } = steps(call, fn);
  const values = pairs.flatMap((p) => (p.value ? [p.value] : []));
  return {
    call,
    fn,
    client: "net-http",
    url,
    method,
    body: body?.expr.k === "null" ? undefined : body,
    bodyRole: "body",
    encoding: encodingOf(pairs, ctx),
    headers: [],
    pairs,
    ...(auth ? { auth } : {}),
    inputs: [url, method, body, ...values].filter((v): v is Scoped => !!v),
  };
}
