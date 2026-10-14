import { calleeChain } from "../../ir/chain.js";
import type { ScopedCall } from "../../ir/fluent.js";
import type { Scoped } from "../../ir/language.js";
import type { CallExpr, ClassDef, Expr, FunctionDef } from "../../ir/model.js";
import { classMethod } from "../../ir/project.js";
import type { IrCtx, IrPair, IrRaw, Seg, Subst } from "../../ir/raw.js";
import { applyStep, calleeIs, emptyParts, fluentChain, lambdaCalls, lambdaOf, readSteps, type BuilderStep, type RequestParts } from "../../ir/steps.js";
import { deref } from "../../ir/values.js";
import { elementsOf } from "../elements.js";
import { substitutionFor } from "../../ir/wrappers.js";
import { withClosures } from "../elements.js";
import { rawOf } from "./request.js";
import { JVM } from "./tables.js";

/**
 * Spring parts a client adds to every request (#46): the headers of RestTemplate interceptors
 * (`ClientHttpRequestInterceptor`, given to the builder or added to `getInterceptors()`) and of WebClient exchange
 * filters (`ClientRequest.from(request).header(...)`); and requests built as a `RequestEntity`, sent by `exchange`.
 */

export interface Handler {
  fn: FunctionDef;
  subst?: Subst;
  self?: ClassDef;
}

/** A lambda, a SAM conversion (`ClientHttpRequestInterceptor { ... }`, `ofRequestProcessor(r -> ...)`) or a project class. */
export function handlerOf(arg: Scoped, methods: string[], ctx: IrCtx): Handler | undefined {
  const d = deref(arg.expr, arg.fn, ctx);
  if (d.expr.k === "fnref") return { fn: d.expr.fn };
  if (d.expr.k !== "call") return undefined;
  const lambda = lambdaOf(d.expr);
  if (lambda) return { fn: lambda };
  const target = calleeChain(d.expr, d.fn, ctx);
  if (target.root.kind !== "class" || target.segs.length > 0) return undefined;
  const cls = target.root.cls;
  const method = methods.map((m) => classMethod(cls, m, ctx.idx)).find((m) => !!m);
  const init = classMethod(cls, "<init>", ctx.idx);
  return method ? { fn: method, self: cls, ...(init ? { subst: substitutionFor(init, d.expr, d.fn) } : {}) } : undefined;
}

const HEADERS: Record<string, BuilderStep> = { ...JVM.springHeaders, header: { header: [0, 1] } };

/** `request.getHeaders().add(k, v)`, `request.headers.set(k, v)`: a call on the request's headers. */
function onHeaders(call: CallExpr): boolean {
  if (call.fn.k !== "attr") return false;
  const obj = call.fn.obj;
  return (obj.k === "call" && obj.fn.k === "attr" && obj.fn.name === "getHeaders") || (obj.k === "attr" && obj.name === "headers");
}

/** `ClientRequest.from(request).header(k, v)`: a copy of a filter's request, with a header. */
function onClientRequest(call: CallExpr): boolean {
  let cur: Expr = call;
  for (let i = 0; i < 16 && cur.k === "call"; i++) {
    if (calleeIs(cur, ["ClientRequest.from"])) return true;
    if (cur.fn.k !== "attr") return false;
    cur = cur.fn.obj;
  }
  return false;
}

function handlerPairs(h: Handler): IrPair[] {
  const parts = emptyParts();
  for (const f of withClosures(h.fn)) readSteps(lambdaCalls(f).filter((c) => onHeaders(c.call) || (calleeIs(c.call, ["header"]) && onClientRequest(c.call))), HEADERS, parts);
  return parts.pairs.map((p) => ({ ...p, from: "interceptor", ...(h.subst ? { subst: h.subst } : {}), ...(h.self ? { self: h.self } : {}) }));
}

/** The headers of the interceptors (or filters) given as these values: each one, or the items of a list of them. */
function interceptorPairs(values: Scoped[], methods: string[], ctx: IrCtx): IrPair[] {
  const out: IrPair[] = [];
  // each item of a list, also an injected `List<ClientHttpRequestInterceptor>` (#75)
  for (const item of values.flatMap((v) => elementsOf(v, ctx))) {
    const h = handlerOf(item, methods, ctx);
    if (h) out.push(...handlerPairs(h));
  }
  return out;
}

/** The interceptors or filters given to the steps of a client's builder (`additionalInterceptors(a, b)`, `filter(f)`). */
export function builderInterceptors(steps: ScopedCall[], names: string[], methods: string[], ctx: IrCtx): IrPair[] {
  const given = steps.filter((s) => calleeIs(s.call, names) !== undefined).flatMap((s) => s.call.args.map((a) => ({ expr: a.value, fn: s.fn })));
  return interceptorPairs(given, methods, ctx);
}

/** `add(i)` / `addAll(list)` on the interceptor list `isList` recognizes, in `fn`: the interceptors added. */
const addedTo = (fn: FunctionDef, isList: (o: Expr) => boolean): Scoped[] =>
  fn.calls.filter((c) => c.fn.k === "attr" && calleeIs(c, ["add", "addAll"]) && isList(c.fn.obj)).flatMap((c) => c.args.map((a) => ({ expr: a.value, fn })));

/**
 * Interceptors added to a template where it is made: `template.getInterceptors().add(i)`, `template.interceptors.add(i)`,
 * `template.interceptors = listOf(i)` (Java's `setInterceptors(List.of(i))` lowers the same), and in its own scope
 * (`RestTemplate().apply { interceptors.add(i) }`).
 */
function addedInterceptors(instance: Seg): Scoped[] {
  const own = (o: Expr): boolean => (o.k === "name" && o.name === "interceptors") || (o.k === "attr" && o.name === "interceptors" && o.obj.k === "this") || (o.k === "call" && o.fn.k === "name" && o.fn.name === "getInterceptors");
  const applied = (instance.call?.applied ?? []).flatMap((f) => addedTo(f, own));
  const fn = instance.fn;
  const name = fn?.assigns.find((a) => a.value === instance.call)?.target;
  if (!fn || !name) return applied;
  const isTemplate = (e: Expr): boolean => e.k === "name" && e.name === name;
  const list = (o: Expr): boolean => (o.k === "call" && o.fn.k === "attr" && o.fn.name === "getInterceptors" && isTemplate(o.fn.obj)) || (o.k === "attr" && o.name === "interceptors" && isTemplate(o.obj));
  const assigned = fn.assigns.filter((a) => a.target === `${name}.interceptors`).map((a) => ({ expr: a.value, fn }));
  return [...addedTo(fn, list), ...assigned, ...applied];
}

/** The interceptors of a RestTemplate: given to its builder, or added to the template where it is made. */
export function restTemplateInterceptors(segs: Seg[], ctx: IrCtx): IrPair[] {
  const steps = segs.flatMap((s) => (s.call && s.fn ? [{ call: s.call, fn: s.fn }] : []));
  const made = segs.find((s) => s.call && s.name === "RestTemplate");
  return [...builderInterceptors(steps, JVM.interceptors.restTemplate, ["intercept"], ctx), ...interceptorPairs(made ? addedInterceptors(made) : [], ["intercept"], ctx)];
}

/** `exchange(RequestEntity.post(uri).header(k, v).body(item), ...)`: the request the entity describes. */
export function requestEntity(raw: IrRaw, ctx: IrCtx): IrRaw | undefined {
  const starts = Object.keys(JVM.requestEntity.starts);
  const fc = raw.url ? fluentChain(raw.url, (c) => calleeIs(c, starts) !== undefined, ctx) : undefined;
  if (!fc?.start) return undefined;
  const p: RequestParts = emptyParts();
  applyStep(p, JVM.requestEntity.starts[calleeIs(fc.start.call, starts)!]!, fc.start);
  readSteps(fc.steps, JVM.requestEntity.steps, p);
  p.baseUrl = raw.baseUrl;
  p.pairs.push(...(raw.pairs ?? []).filter((x) => x.from));
  return { ...rawOf(raw.call, raw.fn, raw.client, p, ctx), ...(fc.subst ? { subst: fc.subst } : {}) };
}
