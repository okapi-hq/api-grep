import { staticText } from "../../resolve/parts.js";
import type { AuthScheme } from "../../types.js";
import type { Chain } from "../ir/chain.js";
import { evaluate } from "../ir/evaluate.js";
import type { Scoped } from "../ir/language.js";
import type { CallExpr, Entry, Expr, FunctionDef } from "../ir/model.js";
import { lastAssign } from "../ir/project.js";
import type { IrCtx, IrRaw } from "../ir/raw.js";
import { deref, dictOf } from "../ir/values.js";

/** What `curl_setopt` options set on a handle. */
interface CurlOptions {
  url?: Scoped;
  method?: Scoped;
  impliedMethod?: string;
  body?: Scoped;
  headers: Scoped[];
  auth?: AuthScheme;
}

const globalName = (e: Expr): string | undefined => (e.k === "name" && !e.name.startsWith("$") ? e.name.toLowerCase() : e.k === "qname" && e.path.length === 1 ? e.path[0]!.toLowerCase() : undefined);

/** `["Authorization: Bearer $t", "Accept: application/json"]` as a header dict. */
export function headerLines(list: Scoped, ctx: IrCtx): Scoped | undefined {
  const d = deref(list.expr, list.fn, ctx);
  if (d.expr.k !== "list") return undefined;
  const entries: Entry[] = [];
  for (const item of d.expr.items) {
    const parts = item.k === "tmpl" || item.k === "concat" ? item.parts : [item];
    const head = parts[0];
    if (head?.k !== "str" || !head.v.includes(":")) continue;
    const i = head.v.indexOf(":");
    const rest: Expr[] = [{ k: "str", v: head.v.slice(i + 1).trimStart() }, ...parts.slice(1)];
    entries.push({ key: { k: "str", v: head.v.slice(0, i).trim() }, value: rest.length === 1 ? rest[0]! : { k: "tmpl", parts: rest } });
  }
  return { expr: { k: "dict", entries }, fn: d.fn };
}

function constName(e: Expr): string | undefined {
  return e.k === "name" && /^CURLOPT_/.test(e.name) ? e.name : undefined;
}

function applyOption(opts: CurlOptions, name: string, value: Scoped, ctx: IrCtx): void {
  const truthy = (): boolean => staticText(evaluate(value.expr, value.fn, ctx)) !== "" && value.expr.k !== "null" && !(value.expr.k === "bool" && !value.expr.v);
  if (name === "CURLOPT_URL") opts.url = value;
  else if (name === "CURLOPT_CUSTOMREQUEST") opts.method = value;
  else if (name === "CURLOPT_POST" && truthy()) opts.impliedMethod ??= "POST";
  else if (name === "CURLOPT_PUT" && truthy()) opts.impliedMethod = "PUT";
  else if (name === "CURLOPT_NOBODY" && truthy()) opts.impliedMethod = "HEAD";
  else if (name === "CURLOPT_POSTFIELDS") opts.body = value;
  else if (name === "CURLOPT_HTTPHEADER") {
    const h = headerLines(value, ctx);
    if (h) opts.headers.push(h);
  } else if (name === "CURLOPT_USERPWD") opts.auth = "basic";
}

/** Options set on `$handle` in the function: `curl_setopt($ch, CURLOPT_X, v)` and `curl_setopt_array($ch, [...])`. */
function curlOptions(handle: string, fn: FunctionDef, ctx: IrCtx): CurlOptions {
  const opts: CurlOptions = { headers: [] };
  for (const c of fn.calls) {
    const name = globalName(c.fn);
    const target = c.args[0]?.value;
    if (!target || target.k !== "name" || target.name !== handle) continue;
    if (name === "curl_setopt" && c.args[1] && c.args[2]) {
      const opt = constName(c.args[1].value);
      if (opt) applyOption(opts, opt, { expr: c.args[2].value, fn }, ctx);
    } else if (name === "curl_setopt_array" && c.args[1]) {
      const dict = dictOf(c.args[1].value, fn, ctx);
      for (const en of dict?.entries ?? []) {
        const opt = en.key ? constName(en.key) : undefined;
        if (opt) applyOption(opts, opt, { expr: en.value, fn: dict!.fn }, ctx);
      }
    }
  }
  return opts;
}

/** `$ch = curl_init($url)` ... `curl_exec($ch)`: one request, reported at `curl_exec`. */
export function detectCurl(call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  if (chain.root.kind !== "global" || chain.root.name.toLowerCase() !== "curl_exec") return undefined;
  const handle = call.args[0]?.value;
  if (!handle || handle.k !== "name") return undefined;
  const init = lastAssign(fn.assigns, handle.name, call.pos.offset);
  const initCall = init && init.value.k === "call" && globalName(init.value.fn) === "curl_init" ? init.value : undefined;
  if (!initCall) return undefined;
  const opts = curlOptions(handle.name, fn, ctx);
  const url = opts.url ?? (initCall.args[0] ? { expr: initCall.args[0].value, fn } : undefined);
  const method = opts.method;
  return {
    call,
    fn,
    client: "curl",
    url,
    method,
    impliedMethod: method ? undefined : (opts.impliedMethod ?? (opts.body ? "POST" : "GET")),
    body: opts.body,
    // an array body is sent as multipart/form-data, a string as is
    bodyRole: opts.body && dictOf(opts.body.expr, opts.body.fn, ctx) ? "body:multipart" : "body:raw",
    headers: opts.headers,
    auth: opts.auth,
    inputs: [url, method, opts.body].filter((v): v is Scoped => !!v),
  };
}
