import { staticText } from "../../resolve/parts.js";
import type { ClientKind } from "../../report/schema.js";
import type { AuthScheme, BodyEncoding } from "../../types.js";
import { calleeChain, type Chain } from "../ir/chain.js";
import { evaluate } from "../ir/evaluate.js";
import type { ScopedCall } from "../ir/fluent.js";
import type { Scoped } from "../ir/language.js";
import { callObject, type CallExpr, type FunctionDef } from "../ir/model.js";
import { withSubst, type IrCtx, type IrPair, type IrRaw } from "../ir/raw.js";
import { rootLength } from "../ir/sdk.js";
import { applyStep, argAt, calleeIs, composeUrl, emptyParts, fluentChain, fluentChains, type BuilderStep, type FluentChain, type RequestParts } from "../ir/steps.js";
import { deref, dictOf } from "../ir/values.js";
import { pairsDict } from "./calls.js";
import data from "./requests.json" with { type: "json" };

/**
 * reqwest, ureq, awc and surf: a request starts with a verb call on a client or the crate (`client.post(url)`,
 * `ureq::get(url)`), takes steps (`.header(k, v)`, `.bearer_auth(t)`, `.json(&body)`), also through variables, fields
 * and the project's functions returning a builder, and is reported at the call that sends it (`.send()`, `.call()`,
 * `.send_json(body)`). A request built in branches (`let req = match api { ... }`) that starts at one call is one
 * request: headers only some branches set are optional.
 */

interface RustStep extends BuilderStep {
  /** A `(name, value)` tuple argument: one header. */
  pair?: number;
}

interface RustRequestClient {
  client: ClientKind;
  imports: string[];
  starts: Record<string, RustStep>;
  steps: Record<string, RustStep>;
  sends: Record<string, RustStep>;
}

const SPECS = data.clients as unknown as RustRequestClient[];
const SEND_NAMES = new Set(SPECS.flatMap((s) => Object.keys(s.sends)));

const methodName = (c: CallExpr): string | undefined => (c.fn.k === "attr" ? c.fn.name : undefined);

const fromCrate = (chain: Chain, spec: RustRequestClient): boolean => chain.root.kind === "external" && rootLength(chain.segs, spec.imports) > 0;

/** `(K, V)` given as one argument: a header. */
function tuplePair(s: Scoped | undefined, ctx: IrCtx): IrPair | undefined {
  const d = s ? deref(s.expr, s.fn, ctx) : undefined;
  if (d?.expr.k !== "list" || d.expr.items.length !== 2) return undefined;
  return { where: "header", name: { expr: d.expr.items[0]!, fn: d.fn }, value: { expr: d.expr.items[1]!, fn: d.fn } };
}

/** `.query(&[("a", x), ("b", y)])`: each pair, added to those of earlier calls. */
function queryPairs(s: Scoped | undefined, ctx: IrCtx): IrPair[] | undefined {
  const d = s ? deref(s.expr, s.fn, ctx) : undefined;
  const dict = d ? pairsDict(d.expr) : undefined;
  return dict?.k === "dict" ? dict.entries.map((e) => ({ where: "query", name: { expr: e.key!, fn: d!.fn }, value: { expr: e.value, fn: d!.fn } })) : undefined;
}

function step(p: RequestParts, s: RustStep, c: ScopedCall, ctx: IrCtx): AuthScheme | undefined {
  const pairs = s.queryMap !== undefined ? queryPairs(argAt(c, s.queryMap), ctx) : undefined;
  if (pairs) p.pairs.push(...pairs);
  applyStep(p, pairs ? { ...s, queryMap: undefined } : s, c);
  const pair = s.pair !== undefined ? tuplePair(argAt(c, s.pair), ctx) : undefined;
  if (pair) p.pairs.push(pair);
  return s.bearer !== undefined ? "bearer" : s.basic ? "basic" : undefined;
}

/** A list of `(k, v)` tuples (`.query(&[("a", b)])`, `.form(&[...])`) as the dict it encodes. */
function asDict(s: Scoped | undefined, ctx: IrCtx): Scoped | undefined {
  if (!s) return undefined;
  const d = deref(s.expr, s.fn, ctx);
  const dict = pairsDict(d.expr);
  return dict ? { expr: dict, fn: d.fn } : s;
}

const textOf = (s: Scoped | undefined, ctx: IrCtx): string | undefined => (s ? staticText(evaluate(s.expr, s.fn, ctx)) : undefined);

/** The encoding a literal content type names (`.header(CONTENT_TYPE, "application/json")`, ureq's `content_type`). */
function encodingOf(p: RequestParts, ctx: IrCtx): BodyEncoding | undefined {
  const header = p.pairs.find((x) => x.where === "header" && textOf(x.name, ctx)?.toLowerCase() === "content-type");
  const value = (textOf(p.contentType, ctx) ?? textOf(header?.value, ctx) ?? "").toLowerCase();
  if (value.includes("x-www-form-urlencoded")) return "form";
  if (value.startsWith("multipart/")) return "multipart";
  if (value.includes("json")) return "json";
  if (value.includes("xml")) return "xml";
  return value ? "raw" : undefined;
}

interface Read {
  p: RequestParts;
  auth?: AuthScheme;
}

/** What the start, the steps and the send set. */
function readRequest(spec: RustRequestClient, fc: FluentChain, send: ScopedCall, ctx: IrCtx): Read {
  const p = emptyParts();
  let auth: AuthScheme | undefined;
  const all = [fc.start!, ...fc.steps];
  all.forEach((c, i) => {
    const name = methodName(c.call) ?? (i === 0 ? calleeIs(c.call, Object.keys(spec.starts)) : undefined);
    const table = i === 0 ? spec.starts : spec.steps;
    const s = name !== undefined && Object.hasOwn(table, name) ? table[name]! : undefined;
    if (s) auth = step(p, s, c, ctx) ?? auth;
  });
  auth = step(p, spec.sends[methodName(send.call)!]!, send, ctx) ?? auth;
  p.pairs.push(...clientDefaults(fc.start!, ctx));
  if (p.body && p.bodyRole === "body:form") p.body = asDict(p.body, ctx);
  return { p, auth };
}

/** Pairs of the other branches' chains (same start) that the first does not set: set on some runs only. */
function mergeBranches(first: Read, others: Read[], ctx: IrCtx): void {
  const key = (x: IrPair): string => `${x.where}:${(textOf(x.name, ctx) ?? "?").toLowerCase()}`;
  const keys = new Set(first.p.pairs.map(key));
  for (const o of others) {
    for (const x of o.p.pairs) {
      if (keys.has(key(x))) continue;
      keys.add(key(x));
      first.p.pairs.push({ ...x, optional: true });
    }
    first.auth ??= o.auth;
  }
  for (const x of first.p.pairs) if (others.some((o) => !o.p.pairs.some((y) => key(y) === key(x)))) x.optional = true;
}

function rawOf(spec: RustRequestClient, r: Read, send: ScopedCall, ctx: IrCtx): IrRaw {
  const { p } = r;
  const url = composeUrl(p);
  const values = p.pairs.flatMap((x) => (x.value ? [x.value] : []));
  return {
    call: send.call,
    fn: send.fn,
    client: spec.client,
    url,
    method: p.method,
    impliedMethod: p.impliedMethod,
    body: p.body,
    bodyRole: p.bodyRole,
    encoding: p.body && !p.bodyRole ? encodingOf(p, ctx) : undefined,
    query: p.query,
    headers: p.headers,
    pairs: p.pairs,
    ...(r.auth ? { auth: r.auth } : {}),
    inputs: [url, p.method, p.body, p.query, ...p.headers, ...values].filter((v): v is Scoped => !!v),
  };
}

const CLIENT_BUILDERS = ["builder", "ClientBuilder.new", "AgentBuilder.new"];

/** What the client adds to every request: `Client::builder().default_headers(h).user_agent(ua).build()`. */
function clientDefaults(start: ScopedCall, ctx: IrCtx): IrPair[] {
  const obj = callObject(start.call);
  if (!obj) return [];
  const fc = fluentChain({ expr: obj, fn: start.fn }, (c) => calleeIs(c, CLIENT_BUILDERS) !== undefined, ctx);
  const out: IrPair[] = [];
  for (const c of fc.start ? fc.steps : []) {
    const [name, arg] = [methodName(c.call), argAt(c, 0)];
    const dict = name === "default_headers" && arg ? dictOf(arg.expr, arg.fn, ctx) : undefined;
    for (const en of dict?.entries ?? []) if (en.key && !en.spread) out.push({ where: "header", name: { expr: en.key, fn: dict!.fn }, value: { expr: en.value, fn: dict!.fn }, from: "default" });
    if (name === "user_agent" && arg) out.push({ where: "header", name: { expr: { k: "str", v: "User-Agent" }, fn: c.fn }, value: arg, from: "default" });
  }
  return out;
}

/** The chains the sent request is built with, those starting at a call of the client only. */
function startedChains(spec: RustRequestClient, send: ScopedCall, ctx: IrCtx): FluentChain[] {
  const obj = callObject(send.call);
  if (!obj) return [];
  const isStart = (c: CallExpr): boolean => calleeIs(c, Object.keys(spec.starts)) !== undefined;
  const receiver = { expr: obj, fn: send.fn };
  const branched = fluentChains(receiver, isStart, ctx).filter((fc) => fc.start);
  const chains = branched.length > 0 ? branched : [fluentChain(receiver, isStart, ctx)].filter((fc) => fc.start);
  return chains.filter((fc) => fromCrate(calleeChain(fc.start!.call, fc.start!.fn, withSubst(ctx, fc.subst)), spec));
}

function detectWith(spec: RustRequestClient, call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  // a send on a value of another crate (`tx.send(x)` on a channel) is not one; an unknown value may be a builder
  if (chain.root.kind === "external" && !fromCrate(chain, spec)) return undefined;
  const send = { call, fn };
  const chains = startedChains(spec, send, ctx);
  if (chains.length === 0) return undefined;
  const reads = chains.map((fc) => ({ fc, read: readRequest(spec, fc, send, withSubst(ctx, fc.subst)) }));
  const first = reads[0]!;
  const same = reads.slice(1).filter((r) => r.fc.start!.call === first.fc.start!.call);
  mergeBranches(first.read, same.map((r) => r.read), ctx);
  const raws = [first, ...reads.slice(1).filter((r) => !same.includes(r))].map((r) => {
    const raw = rawOf(spec, r.read, send, ctx);
    return r.fc.subst ? { ...raw, subst: new Map([...(ctx.subst ?? []), ...r.fc.subst]) } : raw;
  });
  return raws.length > 1 ? { ...raws[0]!, alternatives: raws.slice(1) } : raws[0];
}

/** A request of one of the clients, at the call that sends it. */
export function detectRustRequest(call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  const name = methodName(call);
  if (name === undefined || !SEND_NAMES.has(name)) return undefined;
  for (const spec of SPECS) {
    const raw = Object.hasOwn(spec.sends, name) ? detectWith(spec, call, fn, ctx, chain) : undefined;
    if (raw) return raw;
  }
  return undefined;
}
