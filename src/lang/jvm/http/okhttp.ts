import { calleeChain, type Chain } from "../../ir/chain.js";
import type { Scoped } from "../../ir/language.js";
import type { ScopedCall } from "../../ir/fluent.js";
import { callObject, dottedPath, type CallExpr, type Expr, type FunctionDef } from "../../ir/model.js";
import { withSubst, type IrCtx, type IrPair, type IrRaw, type Subst } from "../../ir/raw.js";
import { argAt, calleeIs, fluentChain, readSteps, type FluentChain } from "../../ir/steps.js";
import { deref } from "../../ir/values.js";
import { elementsOf, withClosures } from "../elements.js";
import { interceptorPairs } from "./interceptor-steps.js";
import { interceptorsOf, type Interceptor } from "./interceptors.js";
import { substitutionFor } from "../../ir/wrappers.js";
import { chainFrom, rawOf } from "./request.js";
import { JVM, type BuiltRequestClient } from "./tables.js";

/**
 * What an OkHttp client adds to each of its requests: the headers and query parameters of the interceptors given to
 * its builder (`OkHttpClient.Builder().addInterceptor { ... }.build()`, also through `newBuilder()`, variables, fields
 * and factories), as pairs with `from: "interceptor"`. A Retrofit client built with `.client(okHttp)` adds the same.
 */
export function okHttpClientFacts(client: Scoped, ctx: IrCtx): IrPair[] {
  const fc = fluentChain(client, () => false, ctx);
  const names = JVM.okhttp.interceptors ?? [];
  const out: IrPair[] = [];
  const seen = new Map<FunctionDef, Subst[]>();
  for (const step of fc.steps) {
    // the interceptor is often a lambda: the argument as written, not a step value
    const first = calleeIs(step.call, names) !== undefined ? step.call.args[0] : undefined;
    const added = first ? [{ arg: { expr: first.value, fn: step.fn }, ctx }] : [...helperAdds(step, names, ctx), ...handedAdds(step, names, ctx)];
    // each interceptor of a collection (an injected `Set<Interceptor>` added in a `forEach`), and those it wraps
    for (const a of added) {
      for (const i of elementsOf(a.arg, a.ctx).flatMap((arg) => interceptorsOf(arg, a.ctx))) {
        // added on several paths (`is AppInterceptor -> addInterceptor(...)`, `is WireInterceptor -> ...`): once
        if (repeated(seen, i)) continue;
        out.push(...interceptorPairs(i, i.ctx.subst || fc.subst ? new Map([...(fc.subst ?? []), ...(i.ctx.subst ?? [])]) : undefined));
      }
    }
  }
  return out;
}

/** The same interceptor code with the same constructor arguments, met before. */
function repeated(seen: Map<FunctionDef, Subst[]>, i: Interceptor): boolean {
  const same = (a: Subst | undefined, b: Subst | undefined): boolean => (a?.size ?? 0) === (b?.size ?? 0) && [...(a ?? [])].every(([p, v]) => b?.get(p)?.expr === v.expr);
  const list = seen.get(i.fn) ?? [];
  if (list.some((s) => same(s, i.subst))) return true;
  seen.set(i.fn, [...list, i.subst ?? (new Map() as Subst)]);
  return false;
}

/** Whether an extension's receiver is OkHttp's client builder (`fun OkHttpClient.Builder.addInterceptors(...)`). */
const onClientBuilder = (ext: FunctionDef): boolean => {
  const path = ext.receiver?.type ? dottedPath(ext.receiver.type)?.join(".") : undefined;
  return !!path && (path.endsWith("OkHttpClient.Builder") || (path === "Builder" && ext.module.importPaths.some((p) => p.join(".") === "okhttp3.OkHttpClient.Builder")));
};

/**
 * `builder.addInterceptors(list)`, a project extension of the client builder (#94): the interceptors it adds
 * (`list.forEach { addInterceptor(it) }`, `forEach(::addInterceptor)`, a `for` loop, `fold(this) { b, i -> ... }`),
 * read with the call's arguments.
 */
function helperAdds(step: ScopedCall, names: string[], ctx: IrCtx): { arg: Scoped; ctx: IrCtx }[] {
  if (step.call.fn.k !== "attr") return [];
  const exts = (ctx.idx.extensions.get(step.call.fn.name) ?? []).filter(onClientBuilder);
  const ext = exts.length === 1 ? exts[0]! : undefined;
  return ext ? addsIn(ext, names, withSubst(ctx, substitutionFor(ext, step.call, step.fn))) : [];
}

/** The interceptors a helper of the project adds to the builder it is given: the `addInterceptor` calls in it. */
function addsIn(helper: FunctionDef, names: string[], ctx: IrCtx): { arg: Scoped; ctx: IrCtx }[] {
  const out: { arg: Scoped; ctx: IrCtx }[] = [];
  for (const f of withClosures(helper)) {
    for (const c of f.calls) {
      const ref = c.fn.k === "attr" && c.fn.name === "forEach" ? c.args[0]?.value : undefined;
      const refName = ref?.k === "name" || ref?.k === "attr" ? ref.name : undefined;
      if (refName && names.includes(refName) && c.fn.k === "attr") out.push({ arg: { expr: c.fn.obj, fn: f }, ctx });
      else if (calleeIs(c, names) !== undefined && c.args[0]) out.push({ arg: { expr: c.args[0].value, fn: f }, ctx });
    }
  }
  return out;
}

/**
 * `Interceptors.addAll(builder, list)` (#100): a project function (a Java static helper, not an extension) given the
 * builder variable a step is made on; the interceptors it adds, read with the call's arguments.
 */
function handedAdds(step: ScopedCall, names: string[], ctx: IrCtx): { arg: Scoped; ctx: IrCtx }[] {
  const v = step.call.fn.k === "attr" && step.call.fn.obj.k === "name" ? step.call.fn.obj.name : undefined;
  if (!v) return [];
  const out: { arg: Scoped; ctx: IrCtx }[] = [];
  for (const c of step.fn.calls) {
    if (c === step.call || c.pos.offset >= step.call.pos.offset || !c.args.some((a) => !a.name && a.value.k === "name" && a.value.name === v)) continue;
    const target = calleeChain(c, step.fn, ctx);
    const helper = target.root.kind === "function" && target.segs.length === 0 && !target.root.fn.receiver ? target.root.fn : undefined;
    // the helper hands its parameter on, it does not add to it: only the calls in it count
    if (helper) out.push(...addsIn(helper, names, withSubst(ctx, substitutionFor(helper, c, step.fn))));
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

/** `callFactory(...)`, `Call.Factory { ... }`, ExoPlayer's `OkHttpDataSource.Factory { ... }`. */
const factoryCall = (c: CallExpr): boolean => {
  const last = c.fn.k === "attr" ? c.fn.name : (dottedPath(c.fn)?.pop() ?? "");
  return last === "callFactory" || last.endsWith("Factory");
};

/**
 * A call factory (`callFactory { request -> client.get().newCall(request) }`, `Call.Factory { ... }`): it sends the
 * requests Retrofit or another library builds, read where they are declared, not a request of its own.
 */
function forwards(fn: FunctionDef, request: Scoped): boolean {
  // the request is the one the factory is given (`request -> client.newCall(request)`)
  const given = request.expr.k === "name" && fn.params.some((p) => request.expr.k === "name" && p.name === request.expr.name);
  const isFn = (a: { name?: string; value: Expr }): boolean => a.value.k === "fnref" && a.value.fn === fn;
  return given && fn.name === "lambda" && !!fn.parent?.calls.some((c) => c.args.some((a) => isFn(a) && (a.name === "callFactory" || factoryCall(c))));
}

/**
 * A request built with a request builder and sent by a client method (`client.newCall(request)`, `httpClient.send(request,
 * handler)`): reported at the send. The client must be the library's, or the request its builder's.
 */
export function detectBuiltRequest(spec: BuiltRequestClient, call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  const send = chain.segs[chain.segs.length - 1];
  const index = send && send.call === call && Object.hasOwn(spec.sends, send.name) ? spec.sends[send.name] : undefined;
  const request = index !== undefined ? argAt({ call, fn }, index) : undefined;
  if (!request || forwards(fn, request)) return undefined;
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
