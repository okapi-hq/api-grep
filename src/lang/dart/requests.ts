import type { Chain } from "../ir/chain.js";
import type { Scoped } from "../ir/language.js";
import type { CallExpr, Entry, Expr, FunctionDef } from "../ir/model.js";
import type { IrCtx, IrRaw } from "../ir/raw.js";
import { rootLength } from "../ir/sdk.js";
import { deref } from "../ir/values.js";

/**
 * package:http requests built as objects, `http.Request(method, uri)` and `http.MultipartRequest(method, uri)`, reported
 * where they are built (as Go's `http.NewRequest`): `request.send()` or any client's `send(request)` sends them. What the
 * function then sets on the variable holding it is the request's: `request.headers['k'] = v` and `headers.addAll(map)`,
 * `request.body = b` / `request.bodyFields = map`, a multipart request's `fields` and `files`.
 */

const STARTS = new Set(["Request", "MultipartRequest"]);

const positional = (call: CallExpr, i: number, fn: FunctionDef): Scoped | undefined => {
  const a = call.args.filter((x) => !x.name && !x.spread)[i];
  return a ? { expr: a.value, fn } : undefined;
};

/** `target.member.method(...)`, written after the request is built. */
function callOn(c: CallExpr, target: string, member: string, method: string, after: number): boolean {
  if (c.pos.offset < after || c.fn.k !== "attr" || c.fn.name !== method) return false;
  const obj = c.fn.obj;
  return obj.k === "attr" && obj.name === member && obj.obj.k === "name" && obj.obj.name === target;
}

interface Parts {
  headers: Scoped[];
  fields: Entry[];
  body?: Scoped;
  form?: Scoped;
}

/** A file part's field name: `MultipartFile.fromPath('file', path)`. */
function fileField(arg: Scoped, ctx: IrCtx): Entry | undefined {
  const made = deref(arg.expr, arg.fn, ctx).expr;
  const name = made.k === "call" ? made.args.find((a) => !a.name)?.value : undefined;
  return name?.k === "str" ? { key: name, value: { k: "unknown", text: "file" } } : undefined;
}

/** What the function sets on the request variable after building it. */
function stepsOn(target: string, fn: FunctionDef, after: number, ctx: IrCtx): Parts {
  const out: Parts = { headers: [], fields: [] };
  for (const s of fn.attrSets ?? []) {
    if (s.target !== target || s.offset < after) continue;
    const value = { expr: s.value, fn };
    if (s.name === "headers") out.headers.push(value);
    else if (s.name === "fields" && s.value.k === "dict") out.fields.push(...s.value.entries);
    else if (s.name === "body") out.body = value;
    else if (s.name === "bodyFields") out.form = value;
  }
  for (const c of fn.calls) {
    const arg = positional(c, 0, fn);
    if (!arg) continue;
    if (callOn(c, target, "headers", "addAll", after)) out.headers.push(arg);
    else if (callOn(c, target, "fields", "addAll", after)) out.fields.push({ value: arg.expr, spread: true });
    else if (callOn(c, target, "files", "add", after)) {
      const file = fileField(arg, ctx);
      if (file) out.fields.push(file);
    }
  }
  return out;
}

export function detectHttpRequest(call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  const last = chain.segs.at(-1);
  if (chain.root.kind !== "external" || last?.call !== call || !STARTS.has(last.name) || rootLength(chain.segs, ["http"]) !== chain.segs.length - 1) return undefined;
  const [method, url] = [positional(call, 0, fn), positional(call, 1, fn)];
  const target = fn.assigns.find((a) => a.value === call && !a.edit)?.target;
  const parts = target ? stepsOn(target, fn, call.pos.offset, ctx) : { headers: [], fields: [] };
  const multipart = last.name === "MultipartRequest";
  const body: Scoped | undefined = multipart && parts.fields.length > 0 ? { expr: { k: "dict", entries: parts.fields } as Expr, fn } : (parts.form ?? parts.body);
  return {
    call,
    fn,
    client: "dart-http",
    url,
    method,
    body,
    bodyRole: multipart ? "body:multipart" : parts.form ? "body:form" : "body",
    headers: parts.headers,
    inputs: [url, method, body, ...parts.headers].filter((v): v is Scoped => !!v),
  };
}
