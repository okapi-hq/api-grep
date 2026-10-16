import type { Scoped } from "../ir/language.js";
import { dottedPath, type CallExpr, type Entry, type Expr, type FunctionDef } from "../ir/model.js";
import { calleeChain } from "../ir/chain.js";
import { lookup } from "../ir/project.js";
import type { IrCtx } from "../ir/raw.js";
import { deref, dictOf, staticKey } from "../ir/values.js";

/**
 * Calls that stand for a value the engine reads: Dio's option objects (`BaseOptions(baseUrl: u, headers: h)`,
 * `Options(headers: h)`) as the dict of their named arguments, and URIs built from parts (`Uri.https(host, path,
 * query)`, `Uri(scheme: 'https', host: h, path: p)`, `uri.replace(queryParameters: q)`) as the URL text they make.
 */

/** Dio's option classes, by the path an import gives them. */
const OPTIONS = new Set(["dio.Options", "dio.BaseOptions", "dio.RequestOptions"]);

/** The library path a call's callee names (`Options` under `import 'package:dio/dio.dart'` -> `dio.Options`). */
function libraryPath(call: CallExpr, fn: FunctionDef, ctx: IrCtx): string | undefined {
  const path = dottedPath(call.fn);
  if (!path) return undefined;
  const b = lookup(path[0]!, fn, call.pos.offset, ctx.idx);
  if (b.kind === "external") return [...b.path, ...path.slice(1)].join(".");
  // `Uri` is dart:core's, imported by every file: a name nothing declares
  return b.kind === "none" ? path.join(".") : undefined;
}

const namedArgs = (call: CallExpr): Entry[] => call.args.filter((a) => a.name).map((a) => ({ key: { k: "str", v: a.name! }, value: a.value }));

const scoped = (expr: Expr, fn: FunctionDef): Expr => ({ k: "scoped", expr, fn });

/** `?k=v&k2=v2` from a query map the code writes; nothing when the map cannot be read. */
function queryParts(q: Expr | undefined, fn: FunctionDef, ctx: IrCtx): Expr[] {
  const dict = q ? dictOf(q, fn, ctx) : undefined;
  if (!dict) return [];
  const parts: Expr[] = [];
  for (const en of dict.entries) {
    const key = en.spread ? undefined : staticKey(en.key, dict.fn, ctx);
    if (key === undefined) continue;
    parts.push({ k: "str", v: `${parts.length === 0 ? "?" : "&"}${key}=` }, scoped(en.value, dict.fn));
  }
  return parts;
}

/** The static text an expression starts with, when it has one. */
function startsWithSlash(e: Expr, fn: FunctionDef, ctx: IrCtx): boolean {
  const d = deref(e, fn, ctx);
  const first = d.expr.k === "tmpl" || d.expr.k === "concat" ? d.expr.parts[0] : d.expr;
  return first?.k === "str" && first.v.startsWith("/");
}

/** `scheme://host[:port]/path?query` from its parts; the path gets the `/` Dart adds. */
function uriFrom(scheme: Expr, host: Expr, port: Expr | undefined, path: Expr | undefined, query: Expr | undefined, fn: FunctionDef, ctx: IrCtx): Expr {
  const parts: Expr[] = [scheme, { k: "str", v: "://" }, host];
  if (port) parts.push({ k: "str", v: ":" }, port);
  if (path) parts.push(...(startsWithSlash(path, fn, ctx) ? [] : [{ k: "str", v: "/" } as Expr]), path);
  return { k: "tmpl", parts: [...parts, ...queryParts(query, fn, ctx)] };
}

function uriCall(name: string, call: CallExpr, fn: FunctionDef, ctx: IrCtx): Expr | undefined {
  const pos = call.args.filter((a) => !a.name).map((a) => a.value);
  const kw = (k: string): Expr | undefined => call.args.find((a) => a.name === k)?.value;
  if ((name === "Uri.https" || name === "Uri.http") && pos[0]) return uriFrom({ k: "str", v: name.slice(4) }, pos[0], undefined, pos[1], pos[2] ?? kw("queryParameters"), fn, ctx);
  const host = kw("host");
  if (name === "Uri" && host) return uriFrom(kw("scheme") ?? { k: "str", v: "https" }, host, kw("port"), kw("path"), kw("queryParameters"), fn, ctx);
  return undefined;
}

/** `uri.replace(queryParameters: q)`: the URI with that query. */
function replacedQuery(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Expr | undefined {
  if (call.fn.k !== "attr" || call.fn.name !== "replace") return undefined;
  const q = call.args.find((a) => a.name === "queryParameters")?.value;
  return q ? { k: "tmpl", parts: [call.fn.obj, ...queryParts(q, fn, ctx)] } : undefined;
}

/** Helpers being read: a helper returning a call of itself is not followed again. */
const reading = new Set<FunctionDef>();

/** `headers: await _headers()`: the map a project helper returns, when it returns one map. */
function helperMap(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  const target = calleeChain(call, fn, ctx);
  const helper = target.root.kind === "function" && target.segs.length === 0 ? target.root.fn : undefined;
  if (!helper || helper.returns.length !== 1 || reading.has(helper)) return undefined;
  reading.add(helper);
  try {
    const ret = { expr: helper.returns[0]!, fn: helper };
    return dictOf(ret.expr, ret.fn, ctx) ? ret : undefined;
  } finally {
    reading.delete(helper);
  }
}

export function dartResolveCall(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  const replaced = replacedQuery(call, fn, ctx);
  if (replaced) return { expr: replaced, fn };
  const name = libraryPath(call, fn, ctx);
  if (!name) return helperMap(call, fn, ctx);
  if (OPTIONS.has(name)) return { expr: { k: "dict", entries: namedArgs(call) }, fn };
  const uri = uriCall(name, call, fn, ctx);
  return uri ? { expr: uri, fn } : undefined;
}
