import { calleeChain, type Chain } from "../../ir/chain.js";
import type { Scoped } from "../../ir/language.js";
import type { ScopedCall } from "../../ir/fluent.js";
import { callObject, type CallExpr, type ClassDef, type Expr, type FunctionDef } from "../../ir/model.js";
import { classMethod } from "../../ir/project.js";
import { withSubst, type IrCtx, type IrPair, type IrRaw, type Subst } from "../../ir/raw.js";
import { argAt, calleeIs, emptyParts, fluentChain, lambdaCalls, lambdaOf, readSteps, type FluentChain } from "../../ir/steps.js";
import { deref } from "../../ir/values.js";
import { substitutionFor } from "../../ir/wrappers.js";
import { chainFrom, rawOf } from "./request.js";
import { JVM, type BuiltRequestClient } from "./tables.js";

/** An interceptor's code, and what its values read: the constructor arguments and class of an interceptor object. */
interface Interceptor {
  fn: FunctionDef;
  subst?: Subst;
  self?: ClassDef;
}

/** `{ chain -> ... }`, `Interceptor { ... }`, `object : Interceptor { ... }`, `AuthInterceptor(token)` (a project class). */
function interceptorOf(arg: Scoped, ctx: IrCtx): Interceptor | undefined {
  const d = deref(arg.expr, arg.fn, ctx);
  if (d.expr.k === "fnref") return { fn: d.expr.fn };
  if (d.expr.k !== "call") return undefined;
  const lambda = lambdaOf(d.expr);
  if (lambda && calleeIs(d.expr, ["Interceptor"])) return { fn: lambda };
  const target = calleeChain(d.expr, d.fn, ctx);
  if (target.root.kind !== "class" || target.segs.length > 0) return undefined;
  const cls = target.root.cls;
  const intercept = classMethod(cls, "intercept", ctx.idx);
  const init = classMethod(cls, "<init>", ctx.idx);
  return intercept ? { fn: intercept, self: cls, ...(init ? { subst: substitutionFor(init, d.expr, d.fn) } : {}) } : undefined;
}

/** A function and the lambdas written in it, at any depth (`chain.request().let { ... }`). */
export function withClosures(fn: FunctionDef): FunctionDef[] {
  const out = [fn];
  for (let i = 0; i < out.length && out.length < 32; i++) out.push(...fn.module.allFunctions.filter((f) => f.parent === out[i] && !out.includes(f)));
  return out;
}

/**
 * A response the interceptor receives or makes (`chain.proceed(request).newBuilder()`, `Response.Builder()`, through
 * variables of the function and the ones around it): the headers set on it are not the request's.
 */
function onResponse(e: Expr, fn: FunctionDef, depth = 0): boolean {
  if (depth > 8) return false;
  if (e.k === "name") {
    for (let f: FunctionDef | undefined = fn; f; f = f.parent) {
      const set = f.assigns.filter((a) => a.target === e.name).pop();
      if (set) return onResponse(set.value, f, depth + 1);
    }
    return false;
  }
  if (e.k !== "call") return false;
  if (calleeIs(e, ["Response.Builder"]) !== undefined) return true;
  return e.fn.k === "attr" && (e.fn.name === "proceed" || onResponse(e.fn.obj, fn, depth + 1));
}

/**
 * Header and query steps of the request: two arguments (`request.header("X")` reads one) on anything but a response.
 */
const requestStep = (c: ScopedCall): boolean => c.call.args.length >= 2 && !(c.call.fn.k === "attr" && onResponse(c.call.fn.obj, c.fn));

/**
 * The headers and query parameters an interceptor adds to every request (`header("Authorization", ...)`,
 * `addQueryParameter(...)`), read with the arguments of the client factories the client was built through (`outer`).
 */
function interceptorPairs(i: Interceptor, outer: Subst | undefined): IrPair[] {
  const parts = emptyParts();
  for (const f of withClosures(i.fn)) readSteps(lambdaCalls(f).filter(requestStep), JVM.okhttp.interceptor!, parts);
  const subst = outer || i.subst ? new Map([...(outer ?? []), ...(i.subst ?? [])]) : undefined;
  return parts.pairs.map((p) => ({ ...p, from: "interceptor", ...(subst ? { subst } : {}), ...(i.self ? { self: i.self } : {}) }));
}

/**
 * What an OkHttp client adds to each of its requests: the headers and query parameters of the interceptors given to
 * its builder (`OkHttpClient.Builder().addInterceptor { ... }.build()`, also through `newBuilder()`, variables, fields
 * and factories), as pairs with `from: "interceptor"`. A Retrofit client built with `.client(okHttp)` adds the same.
 */
export function okHttpClientFacts(client: Scoped, ctx: IrCtx): IrPair[] {
  const fc = fluentChain(client, () => false, ctx);
  const names = JVM.okhttp.interceptors ?? [];
  const out: IrPair[] = [];
  for (const step of fc.steps) {
    // the interceptor is often a lambda: the argument as written, not a step value
    const first = calleeIs(step.call, names) !== undefined ? step.call.args[0] : undefined;
    const arg = first ? { expr: first.value, fn: step.fn } : undefined;
    const i = arg ? interceptorOf(arg, ctx) : undefined;
    if (i) out.push(...interceptorPairs(i, fc.subst));
  }
  return out;
}

/**
 * `request.newBuilder().header("Authorization", ...)`: a copy of a request built in the project, whose own steps (its
 * URL, method, body) come first. A `newBuilder()` on anything else stays where the chain starts.
 */
function copiedRequest(fc: FluentChain, spec: BuiltRequestClient, ctx: IrCtx): FluentChain {
  const start = fc.start;
  if (!start || start.call.fn.k !== "attr" || start.call.fn.name !== "newBuilder" || start.call.args.length > 0) return fc;
  const base = fluentChain({ expr: start.call.fn.obj, fn: start.fn }, (c) => calleeIs(c, spec.starts) !== undefined, ctx);
  if (!base.start || calleeIs(base.start.call, spec.starts.filter((s) => s.includes("."))) === undefined) return fc;
  const subst = base.subst || fc.subst ? new Map([...(base.subst ?? []), ...(fc.subst ?? [])]) : undefined;
  return { start: base.start, steps: [...base.steps, ...fc.steps], ...(subst ? { subst } : {}) };
}

/**
 * A request built with a request builder and sent by a client method (`client.newCall(request)`, `httpClient.send(request,
 * handler)`): reported at the send. The client must be the library's, or the request its builder's.
 */
export function detectBuiltRequest(spec: BuiltRequestClient, call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  const send = chain.segs[chain.segs.length - 1];
  const index = send && send.call === call && Object.hasOwn(spec.sends, send.name) ? spec.sends[send.name] : undefined;
  const request = index !== undefined ? argAt({ call, fn }, index) : undefined;
  if (!request) return undefined;
  const fc = copiedRequest(fluentChain(request, (c) => calleeIs(c, spec.starts) !== undefined, ctx), spec, ctx);
  // `Request.Builder()` names its library; a bare `newBuilder()` (protobuf, gRPC descriptors) needs the client to
  const own = !!fc.start && calleeIs(fc.start.call, spec.starts.filter((s) => s.includes("."))) !== undefined;
  if (!own && !chainFrom(chain, spec.imports)) return undefined;
  // the client is the library's here when no start was found (`Builder()` imported as `okhttp3.Request.Builder`)
  const parts = readSteps(fc.start ? [fc.start, ...fc.steps] : fc.steps, spec.request);
  const client = spec.interceptors ? callObject(call) : undefined;
  if (client) parts.pairs.push(...okHttpClientFacts({ expr: client, fn }, ctx));
  // `newCall(get("https://..."))`: the factory's parameters read as the arguments of this call
  const inner = withSubst(ctx, fc.subst);
  const raw = ownBodyClass(rawOf(call, fn, spec.client, parts, inner, [request]), inner);
  return fc.subst ? { ...raw, subst: new Map([...(ctx.subst ?? []), ...fc.subst]) } : raw;
}

/**
 * `post(ProgressBody(file))`: a `RequestBody` (or `BodyPublisher`) class of the project writes its own bytes, so its
 * constructor arguments are not the body's fields; the body is opaque.
 */
function ownBodyClass(raw: IrRaw, ctx: IrCtx): IrRaw {
  const d = raw.body ? deref(raw.body.expr, raw.body.fn, ctx) : undefined;
  if (d?.expr.k !== "call") return raw;
  const c = calleeChain(d.expr, d.fn, ctx);
  if (c.root.kind !== "class" || c.segs.length > 0) return raw;
  return { ...raw, body: { expr: { k: "unknown", text: c.root.cls.name }, fn: d.fn }, encoding: raw.encoding ?? "raw" };
}

export const detectOkHttp = (call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined => detectBuiltRequest(JVM.okhttp, call, fn, ctx, chain);

export const detectJavaHttp = (call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined => detectBuiltRequest(JVM.javaHttp, call, fn, ctx, chain);
