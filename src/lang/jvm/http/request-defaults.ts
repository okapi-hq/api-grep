import type { ScopedCall } from "../../ir/fluent.js";
import type { Scoped } from "../../ir/language.js";
import type { CallExpr, Expr, ModuleModel } from "../../ir/model.js";
import type { ProjectIndex } from "../../ir/project.js";
import type { ClientPartFrom, IrCtx, IrPair } from "../../ir/raw.js";
import { argAt, calleeIs, emptyParts, fluentChain, lambdaCalls, readSteps, type BuilderStep, type RequestParts } from "../../ir/steps.js";
import { deref } from "../../ir/values.js";
import { nameValuePairs } from "./name-value-pairs.js";
import { withClosures } from "./okhttp.js";
import { handlerOf, type Handler } from "./spring-parts.js";

/**
 * What a client of `requests.json` adds to every request it sends (#73): the default headers and the filters or
 * interceptors of its builder (Apache `setDefaultHeaders`, `addInterceptorFirst`; JAX-RS `register(filter)`), and a
 * configuration made apart (`Unirest.config().defaultBaseUrl(u).setDefaultHeader(k, v)`).
 */
export interface ClientDefaults {
  /** Where the client is: the object the request is sent on (`client.execute(r)`) or started on (`client.target(u)`). */
  on: "send" | "start";
  /** Builder steps given a list of headers (`setDefaultHeaders(List.of(new BasicHeader(k, v)))`), and the header class. */
  headerLists?: string[];
  headerItems?: string[];
  /** Builder steps given a filter or interceptor, the methods of a filter class that see the request, and the header steps it makes on it. */
  filters?: string[];
  filterMethods?: string[];
  filterSteps?: Record<string, BuilderStep>;
  /** A configuration of the client made apart (`Unirest.config()`): the call that gives it, the class of the global one, its steps. */
  config?: { call: string; owner: string; baseUrl: string; steps: Record<string, BuilderStep> };
}

export interface Defaults {
  baseUrl?: Scoped;
  pairs: IrPair[];
}

const LISTS = { lists: ["ArrayList", "LinkedList", "Lists.newArrayList"], add: ["add"] };

const fromAll = (pairs: IrPair[], from: ClientPartFrom, h?: Handler): IrPair[] =>
  pairs.map((p) => ({ ...p, from, ...(h?.subst ? { subst: h.subst } : {}), ...(h?.self ? { self: h.self } : {}) }));

/** `request.addHeader(k, v)` on the filter's request (its first parameter), or `context.getHeaders().add(k, v)`. */
function onRequest(call: CallExpr, param: string): boolean {
  if (call.fn.k !== "attr" || call.args.length < 2) return false;
  const obj = call.fn.obj;
  const isParam = (e: Expr): boolean => e.k === "name" && e.name === param;
  return isParam(obj) || (obj.k === "call" && obj.fn.k === "attr" && obj.fn.name === "getHeaders" && isParam(obj.fn.obj)) || (obj.k === "attr" && obj.name === "headers" && isParam(obj.obj));
}

/** The headers the filters given to these steps set on each request. */
function filterPairs(steps: ScopedCall[], d: ClientDefaults, ctx: IrCtx): IrPair[] {
  const out: IrPair[] = [];
  for (const s of steps) {
    const first = d.filters && calleeIs(s.call, d.filters) !== undefined ? s.call.args[0] : undefined;
    const h = first ? handlerOf({ expr: first.value, fn: s.fn }, d.filterMethods ?? [], ctx) : undefined;
    const param = h?.fn.params[0]?.name;
    if (!h || !param) continue;
    const parts = emptyParts();
    for (const f of withClosures(h.fn)) readSteps(lambdaCalls(f).filter((c) => onRequest(c.call, param)), d.filterSteps ?? {}, parts);
    out.push(...fromAll(parts.pairs, "interceptor", h));
  }
  return out;
}

/** `setDefaultHeaders(List.of(new BasicHeader("X-Key", key)))`: each header of the list. */
function listPairs(steps: ScopedCall[], d: ClientDefaults, ctx: IrCtx): IrPair[] {
  const out: IrPair[] = [];
  for (const s of steps) {
    const list = d.headerLists && calleeIs(s.call, d.headerLists) !== undefined ? argAt(s, 0) : undefined;
    const dict = list ? nameValuePairs(list, { items: d.headerItems ?? [], ...LISTS }, ctx) : undefined;
    if (dict?.expr.k !== "dict") continue;
    for (const en of dict.expr.entries) if (en.key) out.push({ where: "header", name: { expr: en.key, fn: dict.fn }, value: { expr: en.value, fn: dict.fn }, from: "default" });
  }
  return out;
}

interface ConfigCall extends ScopedCall {
  owner: string;
}

const CONFIGS = new WeakMap<ProjectIndex, Map<ClientDefaults, ConfigCall[]>>();

/** `Unirest.config()` (the global configuration) or `unirest.config()` on an instance, keyed per file. */
function ownerKey(e: Expr, mod: ModuleModel, global: string): string | undefined {
  const name = e.k === "name" || e.k === "attr" ? e.name : e.k === "qname" ? e.path.at(-1) : undefined;
  if (name === undefined) return undefined;
  return name === global ? global : `${mod.file}#${name}`;
}

/** The steps of every `X.config()` chain in the files `uses` accepts, with the client they configure. */
function configCalls(d: ClientDefaults, uses: (m: ModuleModel) => boolean, ctx: IrCtx): ConfigCall[] {
  let byIdx = CONFIGS.get(ctx.idx);
  if (!byIdx) CONFIGS.set(ctx.idx, (byIdx = new Map<ClientDefaults, ConfigCall[]>()));
  const hit = byIdx.get(d);
  if (hit) return hit;
  const cfg = d.config!;
  const names = [cfg.baseUrl, ...Object.keys(cfg.steps)];
  const out: ConfigCall[] = [];
  for (const mod of ctx.idx.all()) {
    if (!uses(mod)) continue;
    for (const fn of mod.allFunctions) {
      for (const call of fn.calls) {
        if (calleeIs(call, names) === undefined || call.fn.k !== "attr") continue;
        let cur: Expr = call.fn.obj;
        for (let i = 0; i < 32 && cur.k === "call" && cur.fn.k === "attr" && cur.fn.name !== cfg.call; i++) cur = cur.fn.obj;
        const owner = cur.k === "call" && cur.fn.k === "attr" && cur.fn.name === cfg.call && cur.args.length === 0 ? ownerKey(cur.fn.obj, mod, cfg.owner) : undefined;
        if (owner !== undefined) out.push({ call, fn, owner });
      }
    }
  }
  byIdx.set(d, out);
  return out;
}

/** What the configuration of the client a request is started on gives: a base URL when one is set, and its default headers. */
function configured(d: ClientDefaults, start: ScopedCall, uses: (m: ModuleModel) => boolean, ctx: IrCtx): Defaults {
  const receiver = start.call.fn.k === "attr" ? start.call.fn.obj : undefined;
  const owner = receiver ? ownerKey(receiver, start.fn.module, d.config!.owner) : undefined;
  const calls = owner === undefined ? [] : configCalls(d, uses, ctx).filter((c) => c.owner === owner);
  const bases = calls.filter((c) => calleeIs(c.call, [d.config!.baseUrl]) !== undefined);
  const parts: RequestParts = readSteps(calls, d.config!.steps);
  // several base URLs set for one client: none of them is known to be the one in use
  return { ...(bases.length === 1 ? { baseUrl: argAt(bases[0]!, 0) } : {}), pairs: fromAll(parts.pairs, "default") };
}

/** The defaults of the client a request is sent or started on: its builder's steps, and a configuration made apart. */
export function clientDefaults(d: ClientDefaults | undefined, send: ScopedCall, start: ScopedCall | undefined, uses: (m: ModuleModel) => boolean, ctx: IrCtx): Defaults {
  if (!d) return { pairs: [] };
  const at = d.on === "send" ? send : start;
  const client = at?.call.fn.k === "attr" ? { expr: at.call.fn.obj, fn: at.fn } : undefined;
  const steps = client ? fluentChain(client, () => false, ctx).steps : [];
  const own = d.config && start ? configured(d, start, uses, ctx) : { pairs: [] };
  return { baseUrl: own.baseUrl, pairs: [...listPairs(steps, d, ctx), ...filterPairs(steps, d, ctx), ...own.pairs] };
}

/** The filters registered on the request's own chain (JAX-RS `target.register(filter)`). */
export const chainFilters = (d: ClientDefaults | undefined, steps: ScopedCall[], ctx: IrCtx): IrPair[] => (d ? filterPairs(steps, d, ctx) : []);

const HTTP_SCHEME = /^https?$/i;
const literal = (s: Scoped | undefined, ctx: IrCtx): Expr | undefined => (s ? deref(s.expr, s.fn, ctx).expr : undefined);

/**
 * The target host given apart (`client.execute(new HttpHost("api.example.com", 443, "https"), request)`), as a base URL:
 * `HttpHost.create(url)`, HttpClient 4's `(host, port, scheme)` and 5's `(scheme, host, port)`. Its scheme is `http`
 * unless given; a literal port other than the scheme's is in the URL.
 */
export function hostBase(arg: Scoped | undefined, hosts: string[] | undefined, ctx: IrCtx): Scoped | undefined {
  const d = arg && hosts ? deref(arg.expr, arg.fn, ctx) : undefined;
  if (d?.expr.k !== "call" || calleeIs(d.expr, hosts!) === undefined) return undefined;
  const c: ScopedCall = { call: d.expr, fn: d.fn };
  if (calleeIs(d.expr, ["create"]) !== undefined) return argAt(c, 0);
  const args = [0, 1, 2].map((i) => argAt(c, i));
  const first = literal(args[0], ctx);
  const [scheme, host, port] = args[2] && first?.k === "str" && HTTP_SCHEME.test(first.v) ? args : [args[2], args[0], args[1]];
  if (!host) return undefined;
  const s = literal(scheme, ctx);
  const schemeText = s?.k === "str" && HTTP_SCHEME.test(s.v) ? s.v.toLowerCase() : scheme ? undefined : "http";
  const p = literal(port, ctx);
  const number = p?.k === "num" ? p.v : undefined;
  const omitted = number === undefined || number < 0 || (schemeText === "http" && number === 80) || (schemeText === "https" && number === 443);
  const head: Expr = schemeText ? { k: "str", v: `${schemeText}://` } : { k: "tmpl", parts: [scheme!.expr, { k: "str", v: "://" }] };
  const parts: Expr[] = [head, host.expr, ...(omitted ? [] : [{ k: "str", v: `:${number}` } as Expr])];
  return { expr: { k: "tmpl", parts }, fn: c.fn };
}

/** The steps a credentials object stands for (Vert.x `authentication(new TokenCredentials(token))`), on its own call. */
export function credentialSteps(arg: Scoped | undefined, table: Record<string, BuilderStep>, ctx: IrCtx): { step: BuilderStep; on: ScopedCall } | undefined {
  const d = arg ? deref(arg.expr, arg.fn, ctx) : undefined;
  const name = d?.expr.k === "call" ? calleeIs(d.expr, Object.keys(table)) : undefined;
  return d?.expr.k === "call" && name !== undefined ? { step: table[name]!, on: { call: d.expr, fn: d.fn } } : undefined;
}

