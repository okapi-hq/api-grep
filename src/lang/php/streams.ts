import type { Chain } from "../ir/chain.js";
import { evaluate } from "../ir/evaluate.js";
import type { Scoped } from "../ir/language.js";
import type { CallExpr, Entry, Expr, FunctionDef } from "../ir/model.js";
import type { IrCtx, IrRaw } from "../ir/raw.js";
import { deref, dictOf, entryOf } from "../ir/values.js";
import { headerLines } from "./curl.js";

const HTTP_URL = /^https?:\/\//i;

/** The `http` options of `stream_context_create(['http' => [...]])` behind a context argument. */
function httpContext(ctxArg: Scoped | undefined, ctx: IrCtx): { entries: Entry[]; fn: FunctionDef } | undefined {
  if (!ctxArg) return undefined;
  const d = deref(ctxArg.expr, ctxArg.fn, ctx);
  if (d.expr.k !== "call" || d.expr.fn.k !== "name" || d.expr.fn.name.toLowerCase() !== "stream_context_create" || !d.expr.args[0]) return undefined;
  const outer = dictOf(d.expr.args[0].value, d.fn, ctx);
  const http = outer ? (entryOf(outer, "http", ctx) ?? entryOf(outer, "https", ctx)) : undefined;
  return http ? dictOf(http.expr, http.fn, ctx) : undefined;
}

/** `"A: b\r\nC: d"` or `["A: b", "C: d"]`: header lines as a header dict. */
function headersOf(h: Scoped, ctx: IrCtx): Scoped | undefined {
  const d = deref(h.expr, h.fn, ctx);
  if (d.expr.k === "list") return headerLines(d, ctx);
  const text = d.expr.k === "str" ? d.expr.v : undefined;
  if (text === undefined) return undefined;
  const items: Expr[] = text.split(/\r?\n/).filter(Boolean).map((v) => ({ k: "str", v }));
  return headerLines({ expr: { k: "list", items }, fn: d.fn }, ctx);
}

/**
 * `file_get_contents('https://...')` and `file_get_contents($url, false, stream_context_create(['http' => [...]]))`.
 * A path that is not an http(s) URL, without an http context, is a file read and is not reported.
 */
export function detectStream(call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  if (chain.root.kind !== "global" || !/^(?:file_get_contents|fopen)$/i.test(chain.root.name)) return undefined;
  const urlArg = call.args[0];
  if (!urlArg) return undefined;
  const url: Scoped = { expr: urlArg.value, fn };
  const ctxArgIndex = chain.root.name.toLowerCase() === "fopen" ? 3 : 2;
  const context = httpContext(call.args[ctxArgIndex] ? { expr: call.args[ctxArgIndex].value, fn } : undefined, ctx);
  const head = evaluate(url.expr, fn, ctx)[0];
  const isHttp = head?.kind === "static" ? HTTP_URL.test(head.text) : head?.kind === "env";
  if (!isHttp && !context) return undefined;
  const get = (k: string): Scoped | undefined => (context ? entryOf(context, k, ctx) : undefined);
  const method = get("method");
  const body = get("content");
  const header = get("header");
  const headers = header ? headersOf(header, ctx) : undefined;
  return {
    call,
    fn,
    client: "php-stream",
    url,
    method,
    impliedMethod: method ? undefined : "GET",
    body,
    bodyRole: "body",
    headers: headers ? [headers] : [],
    inputs: [url, method, body].filter((v): v is Scoped => !!v),
  };
}
