import { staticText } from "../../../resolve/parts.js";
import type { ClientKind } from "../../../report/schema.js";
import { calleeChain, typeChain, type Chain } from "../../ir/chain.js";
import { evaluate } from "../../ir/evaluate.js";
import { scopedIn, type ScopedCall } from "../../ir/fluent.js";
import type { Scoped } from "../../ir/language.js";
import { callObject, type CallExpr, type Entry, type Expr, type FunctionDef, type ModuleModel } from "../../ir/model.js";
import { lookup } from "../../ir/project.js";
import { withSubst, type IrCtx, type IrRaw } from "../../ir/raw.js";
import { applyStep, argAt, calleeIs, emptyParts, fluentChain, fluentChains, type BuilderStep, type FluentChain, type RequestParts } from "../../ir/steps.js";
import { deref } from "../../ir/values.js";
import { nameValuePairs } from "./name-value-pairs.js";
import { alternatives, oneOf, startsVary, type Alternative } from "./request-alternatives.js";
import { chainFilters, clientDefaults, credentialSteps, hostBase, type ClientDefaults } from "./request-defaults.js";
import { chainFrom, rawOf } from "./request.js";
import data from "./requests.json" with { type: "json" };
import { hostPath, type ClientOptions } from "./vertx.js";

/** A call a request starts from; Vert.x `get(port, host, uri)`: `(port, host, uri)`, `(host, uri)` or `(uri)` from `hostPath`. */
interface RequestStart extends BuilderStep {
  hostPath?: number;
}

/** A call that sends the request: what it sets itself (`post(entity)`), and the arguments the request may be (else its receiver). */
interface SendStep extends BuilderStep {
  request?: number[];
}

/** A client whose request is an object built in steps, then sent (`client.execute(new HttpPost(url))`, `Unirest.post(url).asJson()`). */
interface RequestClient {
  client: ClientKind;
  imports: string[];
  sends: Record<string, SendStep>;
  starts: Record<string, RequestStart>;
  request: Record<string, BuilderStep>;
  /** Form fields set one at a time: a form body for a method that sends one, else query parameters. */
  fields?: Record<string, [number, number]>;
  /** The types a request built elsewhere is declared with (a wrapper's parameter), by simple name. */
  requestTypes: string[];
  /** Steps the request must have one of (JAX-RS `request()`). */
  requires?: string[];
  /** The defaults a client is created with (Vert.x `WebClientOptions`), for `hostPath` starts. */
  clientOptions?: ClientOptions;
  /** The class of a target host given before the request (Apache `execute(new HttpHost(...), request)`). */
  hosts?: string[];
  /** What the client adds to every request: default headers, filters, a configured base URL. */
  defaults?: ClientDefaults;
  /** Steps given a credentials object (Vert.x `authentication(new TokenCredentials(t))`): the step each class stands for. */
  credentials?: { steps: string[]; classes: Record<string, BuilderStep> };
}

const SPECS = data.clients as unknown as RequestClient[];
const SEND_NAMES = new Set(SPECS.flatMap((s) => Object.keys(s.sends)));
const MAX_LINEAGE = 12;
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const NO_BODY = new Set(["GET", "HEAD"]);

const imported = new WeakMap<ModuleModel, Map<RequestClient, boolean>>();

/** Whether a file imports a package of the client (or a class of it): a request it builds can be the client's. */
function importsClient(mod: ModuleModel, spec: RequestClient): boolean {
  let byModule = imported.get(mod);
  if (!byModule) imported.set(mod, (byModule = new Map<RequestClient, boolean>()));
  let hit = byModule.get(spec);
  if (hit === undefined) {
    const paths = [...mod.importPaths, ...(mod.wildcards ?? [])].map((p) => p.join("."));
    hit = spec.imports.some((r) => paths.some((p) => p === r || p.startsWith(`${r}.`)));
    byModule.set(spec, hit);
  }
  return hit;
}

const methodName = (c: CallExpr): string | undefined => (c.fn.k === "attr" ? c.fn.name : undefined);

/**
 * Whether the request expression is the result of a send (`target.request().get().getHeaders().get("X")` reads the
 * response of the first `get`), following the values of variables down to the start.
 */
function sentBefore(spec: RequestClient, s: Scoped, ctx: IrCtx): boolean {
  let cur: Scoped | undefined = s;
  const starts = Object.keys(spec.starts);
  for (let i = 0; cur && i < MAX_LINEAGE; i++) {
    const e: Expr = cur.expr;
    if (e.k === "call") {
      if (calleeIs(e, starts) !== undefined) return false;
      const name = methodName(e);
      if (name !== undefined && Object.hasOwn(spec.sends, name)) return true;
      cur = e.fn.k === "attr" ? { expr: e.fn.obj, fn: cur.fn } : undefined;
    } else if (e.k === "name") {
      const b = lookup(e.name, cur.fn, e.pos.offset, ctx.idx);
      cur = b.kind === "value" ? { expr: b.assign.value, fn: b.fn } : undefined;
    } else cur = e.k === "scoped" ? { expr: e.expr, fn: e.fn } : undefined;
  }
  return false;
}

interface Found {
  request: Scoped;
  /** The chains the request may be built with: one per start it may have (`fluentChains`), else the one followed. */
  chains: FluentChain[];
}

/** The request a send call sends: its receiver, or the first of its request arguments a start is found in. */
function requestOf(spec: RequestClient, send: SendStep, c: ScopedCall, ctx: IrCtx): Found | undefined {
  const names = Object.keys(spec.starts);
  const isStart = (x: CallExpr): boolean => calleeIs(x, names) !== undefined;
  const obj = callObject(c.call);
  const receiver = obj ? { expr: obj, fn: c.fn } : undefined;
  const candidates = send.request ? send.request.map((i) => argAt(c, i)) : [receiver];
  let first: Found | undefined;
  for (const request of candidates) {
    if (!request) continue;
    const started = fluentChains(request, isStart, ctx).filter((fc) => fc.start);
    if (started.length > 0) return { request, chains: started };
    const fc = fluentChain(request, isStart, ctx);
    if (fc.start) return { request, chains: [fc] };
    first ??= { request, chains: [fc] };
  }
  return first;
}

/**
 * A request a wrapper's callers build: the chain ends at a parameter no caller's argument stands for here. Sent as an
 * argument (`client.execute(request)`), the client must be the library's or the parameter declared with one of its
 * types; sent by a call on it (`request.async().get()`), the parameter must be declared as one of its request types.
 */
function fromParam(end: Scoped | undefined, spec: RequestClient, send: SendStep, own: boolean, ctx: IrCtx): boolean {
  if (end?.expr.k !== "name") return false;
  const b = lookup(end.expr.name, end.fn, end.expr.pos.offset, ctx.idx);
  if (b.kind !== "param" || ctx.subst?.has(b.param)) return false;
  const typed = !!b.param.type && chainFrom(typeChain(b.param.type, b.fn, ctx), spec.imports);
  if (send.request) return own || typed;
  return typed && spec.requestTypes.includes(typeName(b.param.type) ?? "");
}

/** One step: a pair with a single argument is a map of them (Unirest `queryString(map)`). */
function stepFor(step: BuilderStep, c: ScopedCall): BuilderStep {
  if (step.query && !argAt(c, step.query[1])) return { queryMap: step.query[0] };
  return step;
}

/** The parts the start, the steps and the send set, with form fields apart. */
function readRequest(spec: RequestClient, fc: Alternative, send: SendStep, sendCall: ScopedCall, ctx: IrCtx): { p: RequestParts; fields: Entry[] } {
  const p = emptyParts();
  const fields: Entry[] = [];
  if (fc.start) {
    const step = spec.starts[calleeIs(fc.start.call, Object.keys(spec.starts))!]!;
    applyStep(p, step, fc.start);
    if (step.hostPath !== undefined && spec.clientOptions) hostPath(p, fc.start, step.hostPath, spec.clientOptions, ctx);
    if (fc.varies) [p.impliedMethod, p.method] = [undefined, { expr: { k: "unknown", text: "method" }, fn: fc.start.fn }];
  }
  // one of several starts, a GET or HEAD: a body set after them (`if (verb.permitsBody()) b.setBody(x)`) is another start's
  const bodiless = !!fc.split && !!p.impliedMethod && NO_BODY.has(p.impliedMethod);
  const sharedFrom = fc.steps.length - (fc.shared ?? 0);
  fc.steps.forEach((c, i) => {
    const name = methodName(c.call);
    if (name === undefined) return;
    const keep = bodiless && i >= sharedFrom ? { body: p.body, role: p.bodyRole } : undefined;
    if (Object.hasOwn(spec.request, name)) applyStep(p, stepFor(spec.request[name]!, c), c);
    if (keep) [p.body, p.bodyRole] = [keep.body, keep.role];
    const credentials = spec.credentials?.steps.includes(name) ? credentialSteps(argAt(c, 0), spec.credentials.classes, ctx) : undefined;
    if (credentials) applyStep(p, credentials.step, credentials.on);
    const field = spec.fields && Object.hasOwn(spec.fields, name) ? spec.fields[name]! : undefined;
    const [k, v] = field && !keep ? [argAt(c, field[0]), argAt(c, field[1])] : [];
    if (k && v) fields.push({ key: scopedIn(k.expr, k.fn, sendCall.fn), value: scopedIn(v.expr, v.fn, sendCall.fn) });
  });
  const keep = bodiless ? { body: p.body, role: p.bodyRole } : undefined;
  applyStep(p, send, sendCall);
  if (keep) [p.body, p.bodyRole] = [keep.body, keep.role];
  // JAX-RS `method("GET", Version.class)`: the response type, not an entity
  if (p.body && typeToken(p.body, ctx)) p.body = undefined;
  return { p, fields };
}

const TYPE_TOKENS = ["GenericType", "TypeReference", "ParameterizedTypeReference"];
const ANONYMOUS_TOKEN = new RegExp(`^new\\s+(?:[\\w.]+\\.)?(?:${TYPE_TOKENS.join("|")})\\b`);

/** `Class`, `GenericType<T>` (a generic type is an index of its class). */
function typeName(e: Expr | undefined): string | undefined {
  const t = e?.k === "index" ? e.obj : e;
  return t?.k === "name" || t?.k === "attr" ? t.name : t?.k === "qname" ? t.path.at(-1) : undefined;
}

/**
 * A class (`Version.class`, lowered as the class name), a generic type token (`new GenericType<List<X>>() {}`) or a
 * parameter declared as one (`Class<T> type`).
 */
function typeToken(s: Scoped, ctx: IrCtx): boolean {
  const d = deref(s.expr, s.fn, ctx);
  if (d.expr.k === "call") return calleeIs(d.expr, TYPE_TOKENS) !== undefined;
  if (d.expr.k === "qname") return true;
  // `new GenericType<List<X>>() {}`: an anonymous class without methods, which Java lowers as unknown
  if (d.expr.k === "unknown") return ANONYMOUS_TOKEN.test(d.expr.text);
  if (d.expr.k !== "name") return false;
  const b = lookup(d.expr.name, d.fn, d.expr.pos.offset, ctx.idx);
  if (b.kind === "param") return ["Class", "KClass", ...TYPE_TOKENS].includes(typeName(b.param.type) ?? "");
  return /^[A-Z]/.test(d.expr.name) && (b.kind === "class" || b.kind === "external" || b.kind === "none");
}

/** Form fields: the body of a method that sends one and has no other, else query parameters. */
function placeFields(p: RequestParts, fields: Entry[], fn: FunctionDef, ctx: IrCtx): void {
  if (fields.length === 0) return;
  const method = p.impliedMethod ?? (p.method ? staticText(evaluate(p.method.expr, p.method.fn, ctx))?.toUpperCase() : undefined);
  if (!p.body && method && BODY_METHODS.has(method)) {
    [p.body, p.bodyRole] = [{ expr: { k: "dict", entries: fields }, fn }, "body:form"];
    return;
  }
  for (const f of fields) p.pairs.push({ where: "query", name: { expr: f.key!, fn }, value: { expr: f.value, fn } });
}

function rawFor(spec: RequestClient, fc: Alternative, send: SendStep, sent: ScopedCall, own: boolean, request: Scoped, ctx: IrCtx): IrRaw | undefined {
  const { call, fn } = sent;
  const inner = withSubst(ctx, fc.subst);
  if (fc.start) {
    const library = own || chainFrom(calleeChain(fc.start.call, fc.start.fn, inner), spec.imports);
    const required = !spec.requires || fc.steps.some((s) => calleeIs(s.call, spec.requires!) !== undefined);
    if (!library || !required) return undefined;
  } else if (!fromParam(fc.end, spec, send, own, inner)) return undefined;
  const { p, fields } = readRequest(spec, fc, send, sent, inner);
  placeFields(p, fields, fn, inner);
  const defaults = clientDefaults(spec.defaults, sent, fc.start, (m) => importsClient(m, spec), inner);
  const host = argAt(sent, 0);
  p.baseUrl = (host?.expr !== request.expr ? hostBase(host, spec.hosts, inner) : undefined) ?? defaults.baseUrl ?? p.baseUrl;
  p.pairs.push(...defaults.pairs, ...chainFilters(spec.defaults, fc.steps, inner));
  const raw = rawOf(call, fn, spec.client, p, inner, [request]);
  const pairs = raw.body ? nameValuePairs(raw.body, data.pairs, inner) : undefined;
  const out = pairs ? { ...raw, body: pairs, encoding: raw.encoding ?? "form" } : raw;
  return fc.subst ? { ...out, subst: new Map([...(ctx.subst ?? []), ...fc.subst]) } : out;
}

function detectWith(spec: RequestClient, call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  const own = chainFrom(chain, spec.imports);
  if (!own && !importsClient(fn.module, spec)) return undefined;
  const send = spec.sends[methodName(call)!]!;
  const found = requestOf(spec, send, { call, fn }, ctx);
  if (!found || sentBefore(spec, found.request, ctx)) return undefined;
  const first = found.chains[0]!;
  // more starts than are listed: the first chain, its method unknown when the starts' differ
  const groups: Alternative[][] = alternatives(spec.starts, found.chains) ?? [[{ ...first, varies: startsVary(spec.starts, found.chains) }]];
  const [raw, ...rest] = groups.flatMap((g) => oneOf(g.flatMap((fc) => rawFor(spec, fc, send, { call, fn }, own, found.request, ctx) ?? []), ctx) ?? []);
  return raw && rest.length > 0 ? { ...raw, alternatives: rest } : raw;
}

/**
 * Apache HttpClient 4 and 5 (classic, async and fluent), the JAX-RS client, AsyncHttpClient, Unirest and the Vert.x
 * `WebClient`: a request built from a start call and its steps (also on variables, fields and factories), reported at
 * the call that sends it. The client is the library's when the send is made on its object, or the start call is its.
 */
export function detectRequestClients(call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  const name = methodName(call);
  if (name === undefined || !SEND_NAMES.has(name)) return undefined;
  for (const spec of SPECS) {
    const raw = Object.hasOwn(spec.sends, name) ? detectWith(spec, call, fn, ctx, chain) : undefined;
    if (raw) return raw;
  }
  return undefined;
}
