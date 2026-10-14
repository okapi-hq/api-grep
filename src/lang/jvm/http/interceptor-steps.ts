import { perRequestPairs, reachIn, type RunScope } from "../../ir/conditional.js";
import type { ScopedCall } from "../../ir/fluent.js";
import { dottedPath, type Expr, type FunctionDef } from "../../ir/model.js";
import { lastAssign, lookup } from "../../ir/project.js";
import type { IrCtx, IrPair, Subst } from "../../ir/raw.js";
import { calleeIs, lambdaCalls } from "../../ir/steps.js";
import { substitutionFor } from "../../ir/wrappers.js";
import { withClosures } from "../elements.js";
import type { Interceptor } from "./interceptors.js";
import { JVM } from "./tables.js";

/**
 * A response the interceptor receives or makes (`chain.proceed(request).newBuilder()`, `Response.Builder()`, through
 * variables of the function and the ones around it): the headers set on it are not the request's.
 */
function onResponse(e: Expr, fn: FunctionDef, depth = 0): boolean {
  if (depth > 8) return false;
  if (e.k === "name") {
    for (let f: FunctionDef | undefined = fn; f; f = f.parent) {
      // the value it holds there (`b = b.header(...)` reassigns a builder): an assignment before the read, else the first
      const set = lastAssign(f.assigns, e.name, e.pos.offset);
      if (set) return onResponse(set.value, f, depth + 1);
      // `response.newBuilder().let { builder -> builder.header(...) }`: the lambda's parameter is what `let` runs on
      if (f.params.some((p) => p.name === e.name)) return letReceiver(f, e.name, depth);
    }
    return false;
  }
  if (e.k !== "call") return false;
  if (calleeIs(e, ["Response.Builder"]) !== undefined) return true;
  return e.fn.k === "attr" && (e.fn.name === "proceed" || onResponse(e.fn.obj, fn, depth + 1));
}

/** A `let` / `also` lambda's parameter, lowered with the value it runs on as its default: whether that is a response. */
function letReceiver(lambda: FunctionDef, name: string, depth: number): boolean {
  const p = lambda.params.find((x) => x.name === name);
  return !!p?.default && onResponse(p.default, lambda.parent ?? lambda, depth + 1);
}

/**
 * Header and query steps of the request: two arguments (`request.header("X")` reads one) on anything but a response.
 */
const requestStep = (c: ScopedCall): boolean => c.call.args.length >= 2 && !(c.call.fn.k === "attr" && onResponse(c.call.fn.obj, c.fn));

/** Code an interceptor runs (its function and closures, or a helper it calls), and what that code reads. */
interface StepScope extends RunScope {
  fns: FunctionDef[];
  subst?: Subst;
}

/** Whether a call made at `offset` in `fn` of a scope runs on some runs of the interceptor only. */
const skippedAt = (scope: StepScope, fn: FunctionDef, offset: number): boolean => !!scope.skipped || reachIn(fn, offset, scope.root).kind !== "always";

/**
 * Local functions an interceptor calls (`fun withToken(r: Request) = r.newBuilder().addHeader(...)` declared next to
 * the lambda in its provider, #100): their steps are the interceptor's, skipped when every call of it may not run.
 */
function localHelpers(scope: StepScope, ctx: IrCtx): StepScope[] {
  const sites = new Map<FunctionDef, boolean[]>();
  for (const f of scope.fns) {
    for (const c of f.calls) {
      const b = c.fn.k === "name" ? lookup(c.fn.name, f, c.pos.offset, ctx.idx) : undefined;
      // a local `fun` is a value of the function it is declared in
      const local = b?.kind === "value" && b.assign.value.k === "fnref" ? b.assign.value.fn : b?.kind === "function" && b.fn.parent && !b.fn.cls ? b.fn : undefined;
      if (local && !scope.fns.includes(local)) sites.set(local, [...(sites.get(local) ?? []), skippedAt(scope, f, c.pos.offset)]);
    }
  }
  return [...sites].map(([h, skipped]) => ({ root: h, fns: withClosures(h), skipped: skipped.every(Boolean) }));
}

/** Whether an extension's receiver is OkHttp's request builder (`fun Request.Builder.addHeaderIfNotEmpty(...)`). */
const onRequestBuilder = (ext: FunctionDef): boolean => {
  const path = ext.receiver?.type ? dottedPath(ext.receiver.type)?.join(".") : undefined;
  return !!path && (path.endsWith("Request.Builder") || (path === "Builder" && ext.module.importPaths.some((p) => p.join(".") === "okhttp3.Request.Builder")));
};

/**
 * A project extension of the request builder an interceptor calls as a step (`newBuilder().addHeaderIfNotEmpty(name,
 * value)`, #100): the code it runs, read with the call's arguments.
 */
function builderExtensions(scopes: StepScope[], ctx: IrCtx): StepScope[] {
  const out: StepScope[] = [];
  for (const scope of scopes) {
    for (const f of scope.fns) {
      for (const c of f.calls) {
        const exts = c.fn.k === "attr" ? (ctx.idx.extensions.get(c.fn.name) ?? []).filter(onRequestBuilder) : [];
        const ext = exts.length === 1 ? exts[0]! : undefined;
        if (ext) out.push({ root: ext, fns: withClosures(ext), skipped: skippedAt(scope, f, c.pos.offset), subst: substitutionFor(ext, c, f) });
      }
    }
  }
  return out;
}

/** The request steps a scope's code makes, those made on some runs only optional (`conditional.ts`). */
const scopePairs = (s: StepScope): IrPair[] => perRequestPairs(s.fns.flatMap((f) => lambdaCalls(f).filter(requestStep)), JVM.okhttp.interceptor!, s);

/**
 * The headers and query parameters an interceptor adds to every request (`header("Authorization", ...)`,
 * `addQueryParameter(...)`), read with the arguments of the client factories the client was built through (`outer`).
 */
export function interceptorPairs(i: Interceptor, outer: Subst | undefined): IrPair[] {
  const main: StepScope = { root: i.fn, fns: withClosures(i.fn) };
  const scopes = [main, ...localHelpers(main, i.ctx)];
  const subst = outer || i.subst ? new Map([...(outer ?? []), ...(i.subst ?? [])]) : undefined;
  const mark = (pairs: IrPair[], s: Subst | undefined): IrPair[] => pairs.map((p) => ({ ...p, from: "interceptor", ...(s ? { subst: s } : {}), ...(i.self ? { self: i.self } : {}) }));
  const extensions = builderExtensions(scopes, i.ctx).map((x) => mark(scopePairs(x), new Map([...(subst ?? []), ...(x.subst ?? [])])));
  return [...mark(scopes.flatMap(scopePairs), subst), ...extensions.flat()];
}
