import { calleeChain, type Chain } from "../../ir/chain.js";
import type { Scoped } from "../../ir/language.js";
import type { CallExpr, ClassDef, FunctionDef } from "../../ir/model.js";
import { classMethod } from "../../ir/project.js";
import type { IrCtx, IrPair, IrRaw, Subst } from "../../ir/raw.js";
import { argAt, calleeIs, emptyParts, fluentChain, lambdaCalls, lambdaOf, readSteps } from "../../ir/steps.js";
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
function withClosures(fn: FunctionDef): FunctionDef[] {
  const out = [fn];
  for (let i = 0; i < out.length && out.length < 32; i++) out.push(...fn.module.allFunctions.filter((f) => f.parent === out[i] && !out.includes(f)));
  return out;
}

/** The headers and query parameters an interceptor adds to every request (`header("Authorization", ...)`, `addQueryParameter(...)`). */
function interceptorPairs(i: Interceptor): IrPair[] {
  const parts = emptyParts();
  for (const f of withClosures(i.fn)) readSteps(lambdaCalls(f), JVM.okhttp.interceptor!, parts);
  return parts.pairs.map((p) => ({ ...p, from: "interceptor", ...(i.subst ? { subst: i.subst } : {}), ...(i.self ? { self: i.self } : {}) }));
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
    if (i) out.push(...interceptorPairs(i));
  }
  return out;
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
  const fc = fluentChain(request, (c) => calleeIs(c, spec.starts) !== undefined, ctx);
  // `Request.Builder()` names its library; a bare `newBuilder()` (protobuf, gRPC descriptors) needs the client to
  const own = !!fc.start && calleeIs(fc.start.call, spec.starts.filter((s) => s.includes("."))) !== undefined;
  if (!own && !chainFrom(chain, spec.imports)) return undefined;
  const parts = readSteps(fc.start ? [fc.start, ...fc.steps] : [], spec.request);
  if (spec.interceptors && call.fn.k === "attr") parts.pairs.push(...okHttpClientFacts({ expr: call.fn.obj, fn }, ctx));
  return rawOf(call, fn, spec.client, parts, ctx, [request]);
}

export const detectOkHttp = (call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined => detectBuiltRequest(JVM.okhttp, call, fn, ctx, chain);

export const detectJavaHttp = (call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined => detectBuiltRequest(JVM.javaHttp, call, fn, ctx, chain);
