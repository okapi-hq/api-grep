import { valueChain, type Chain } from "../ir/chain.js";
import { detectHttp } from "../ir/http.js";
import type { Scoped } from "../ir/language.js";
import type { CallExpr, ClassDef, Expr, FunctionDef } from "../ir/model.js";
import { classMethod, lookup } from "../ir/project.js";
import type { ClientPartFrom, IrCtx, IrPair, IrRaw } from "../ir/raw.js";
import { rootLength } from "../ir/sdk.js";
import { deref, dictOf, entryOf } from "../ir/values.js";
import { DEEP_SETS } from "./names.js";

/**
 * Dio calls, with what the code sets on the instance after building it: `dio.options.baseUrl = u`, `dio.options.headers
 * = {...}` or `['k'] = v`, `dio.options = BaseOptions(...)`, and the headers its interceptors add
 * (`dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) { options.headers['k'] = v; ... }))`, or an
 * `Interceptor` class of the project and its `onRequest`). The instance is a local of the function, or a field of the
 * class (`_dio`, `DioClient.dio`), whose methods are where it is configured.
 */

/** `this._dio.options` -> `this._dio.options`, as names; undefined for anything else. */
function pathOf(e: Expr): string[] | undefined {
  if (e.k === "this") return ["this"];
  if (e.k === "name") return [e.name];
  if (e.k !== "attr") return undefined;
  const p = pathOf(e.obj);
  return p ? [...p, e.name] : undefined;
}

const same = (a: string[] | undefined, b: string[]): boolean => !!a && a.length === b.length && a.every((s, i) => s === b[i]);
const classFns = (cls: ClassDef): FunctionDef[] => cls.module.allFunctions.filter((f) => f.cls === cls);

interface Holder {
  /** Where the instance is configured, and its path there (`this._dio`, a local `dio`). */
  fns: FunctionDef[];
  path: string[];
}

function holderOf(obj: Expr, fn: FunctionDef, at: number, ctx: IrCtx): Holder | undefined {
  const p = pathOf(obj);
  if (!p) return undefined;
  if (p[0] === "this") return fn.cls ? { fns: classFns(fn.cls), path: p } : undefined;
  const b = lookup(p[0]!, fn, at, ctx.idx);
  if (b.kind === "class" && p.length === 2) return { fns: classFns(b.cls), path: ["this", p[1]!] };
  return b.kind === "value" && b.fn === fn && p.length === 1 ? { fns: [fn], path: p } : undefined;
}

interface Defaults {
  baseUrl?: Scoped;
  pairs: IrPair[];
}

/** The headers of a map; `optional` when it is set in a branch (`if (token != null) options.headers[...] = ...`). */
const headerPairs = (dict: Scoped, ctx: IrCtx, from: ClientPartFrom, optional = false): IrPair[] => {
  const d = dictOf(dict.expr, dict.fn, ctx);
  const pair = (key: Expr, value: Expr): IrPair => ({ where: "header", name: { expr: key, fn: d!.fn }, value: { expr: value, fn: d!.fn }, from, ...(optional ? { optional } : {}) });
  return (d?.entries ?? []).flatMap((en) => (en.key && !en.spread ? [pair(en.key, en.value)] : []));
};

const inBranch = (f: FunctionDef, offset: number): boolean => (f.branches ?? []).some((b) => b.start <= offset && offset < b.end);

/** `dio.options = BaseOptions(baseUrl: u, headers: h)`. */
function wholeOptions(value: Scoped, ctx: IrCtx, out: Defaults): void {
  const d = dictOf(value.expr, value.fn, ctx);
  if (!d) return;
  const base = entryOf(d, "baseUrl", ctx);
  if (base) out.baseUrl = base;
  const headers = entryOf(d, "headers", ctx);
  if (headers) out.pairs.push(...headerPairs(headers, ctx, "default"));
}

/** `options.baseUrl = u`, `options.headers = h` / `['k'] = v`, `options = BaseOptions(...)` on the holder. */
function optionSets(h: Holder, ctx: IrCtx, out: Defaults): void {
  const opts = [...h.path, "options"];
  for (const f of h.fns) {
    for (const s of DEEP_SETS.get(f) ?? []) {
      const value = { expr: s.value, fn: f };
      const path = pathOf(s.target);
      if (same(path, [...opts, "baseUrl"])) out.baseUrl = value;
      else if (same(path, [...opts, "headers"])) out.pairs.push(...headerPairs(value, ctx, "default"));
      else if (same(path, opts)) wholeOptions(value, ctx, out);
      else if (s.target.k === "index" && same(pathOf(s.target.obj), [...opts, "headers"])) out.pairs.push({ where: "header", name: { expr: s.target.key, fn: f }, value, from: "default" });
    }
    for (const c of f.calls) {
      if (c.fn.k === "attr" && c.fn.name === "addAll" && same(pathOf(c.fn.obj), [...opts, "headers"]) && c.args[0]) out.pairs.push(...headerPairs({ expr: c.args[0].value, fn: f }, ctx, "default"));
    }
  }
}

/** The functions an interceptor runs on a request: a wrapper's `onRequest`, or a project class's `onRequest` method. */
function onRequest(arg: Scoped, ctx: IrCtx): FunctionDef[] {
  const d = deref(arg.expr, arg.fn, ctx);
  if (d.expr.k === "list") return d.expr.items.flatMap((item) => onRequest({ expr: item, fn: d.fn }, ctx));
  if (d.expr.k !== "call") return [];
  const handler = d.expr.args.find((a) => a.name === "onRequest")?.value;
  const chain = handler ? valueChain(handler, d.fn, ctx) : undefined;
  if (chain?.root.kind === "function") return [chain.root.fn];
  const made = valueChain(d.expr.fn, d.fn, ctx);
  const method = made.root.kind === "class" ? classMethod(made.root.cls, "onRequest", ctx.idx) : undefined;
  return method ? [method] : [];
}

/** The headers an interceptor sets on the options it is given (`options.headers['k'] = v`, `.addAll(map)`). */
function interceptorPairs(f: FunctionDef, ctx: IrCtx): IrPair[] {
  const options = f.params[0]?.name;
  if (!options) return [];
  const sets = (f.attrSets ?? []).filter((s) => s.target === options && s.name === "headers").map((s) => ({ value: s.value, at: s.offset }));
  const added = f.calls.filter((c) => c.fn.k === "attr" && c.fn.name === "addAll" && same(pathOf(c.fn.obj), [options, "headers"]) && c.args[0]);
  const maps = [...sets, ...added.map((c) => ({ value: c.args[0]!.value, at: c.pos.offset }))];
  return maps.flatMap((m) => headerPairs({ expr: m.value, fn: f }, ctx, "interceptor", inBranch(f, m.at)));
}

function defaultsOf(h: Holder, ctx: IrCtx): Defaults {
  const out: Defaults = { pairs: [] };
  optionSets(h, ctx, out);
  const interceptors = [...h.path, "interceptors"];
  for (const f of h.fns) {
    for (const c of f.calls) {
      if (c.fn.k !== "attr" || (c.fn.name !== "add" && c.fn.name !== "addAll") || !same(pathOf(c.fn.obj), interceptors) || !c.args[0]) continue;
      for (const handler of onRequest({ expr: c.args[0].value, fn: f }, ctx)) out.pairs.push(...interceptorPairs(handler, ctx));
    }
  }
  return out;
}

export function detectDio(call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  if (chain.root.kind !== "external" || rootLength(chain.segs, ["dio"]) !== 1 || call.fn.k !== "attr") return undefined;
  const raw = detectHttp(chain, call, fn, ctx);
  const holder = raw ? holderOf(call.fn.obj, fn, call.pos.offset, ctx) : undefined;
  if (!raw || !holder) return raw;
  const d = defaultsOf(holder, ctx);
  const pairs = [...(raw.pairs ?? []), ...d.pairs];
  return { ...raw, baseUrl: d.baseUrl ?? raw.baseUrl, ...(pairs.length > 0 ? { pairs } : {}), inputs: [...raw.inputs, ...(d.baseUrl ? [d.baseUrl] : [])] };
}
