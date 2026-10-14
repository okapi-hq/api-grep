import { assembleCalls } from "../../assemble.js";
import { relativePosix } from "../../files.js";
import { rpcClientOperation } from "../../operation/json-rpc.js";
import type { Call, Language, Operation } from "../../report/schema.js";
import type { HeadersResult } from "../../resolve/header-names.js";
import { staticText } from "../../resolve/parts.js";
import { sdkTarget, type SdkSource } from "../../resolve/sdk-template.js";
import { wrapShape } from "../../resolve/shape-utils.js";
import { resolveReference } from "../../resolve/url-reference.js";
import { joinParts, partsToUrlShape } from "../../resolve/url-shape.js";
import type { AuthScheme, BodyEncoding, DynamicPart, Part, Shape, UrlShape } from "../../types.js";
import { argAt, argOf, propOf } from "./args.js";
import { evaluate } from "./evaluate.js";
import type { Scoped } from "./language.js";
import { resolvePairs } from "./pairs.js";
import { withSelf, withSubst, type IrCtx, type IrRaw, type IrSdkMatch } from "./raw.js";
import { resolveIrBody, resolveIrHeaders, resolveIrQuery } from "./request.js";
import { shapeOf } from "./shape.js";
import { irSoapTarget } from "./soap.js";
import { deref } from "./values.js";

export interface BuildIrCtx extends IrCtx {
  rootDir: string;
  language: Language;
  sdkVersion: (file: string, pkg: string) => string | undefined;
}

function urlParts(s: Scoped, ctx: IrCtx): Part[] {
  return evaluate(s.expr, s.fn, ctx);
}

/**
 * A client base URL given as a bare host (`withBaseUri('api.example.com/v1')`) is an https URL. Registry paths start
 * with `/`: a base URL's trailing slash (`config("https://api.eu.mailgun.net/", key)`) is not doubled.
 */
function baseUrlParts(s: Scoped, ctx: IrCtx, rooted: boolean): Part[] {
  const parts = urlParts(s, ctx);
  const first = parts[0];
  const bareHost = first?.kind === "static" && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:\/|$)/i.test(first.text);
  const last = parts[parts.length - 1];
  const trimmed = rooted && last?.kind === "static" && /[^/]\/$/.test(last.text) ? [...parts.slice(0, -1), { ...last, text: last.text.slice(0, -1) }] : parts;
  return bareHost ? [{ kind: "static", text: "https://" }, ...trimmed] : trimmed;
}

function resolveUrl(url: Scoped | undefined, base: Scoped | undefined, ctx: IrCtx, join?: IrRaw["urlJoin"]): UrlShape {
  if (!url && !base) return { hostKind: "unknown", pathTemplate: "/", query: [], queryShape: {}, dynamic: [{ where: "host", name: "url", origin: "unknown" }], raw: "" };
  const pathParts = url ? urlParts(url, ctx) : [];
  const baseParts = base ? urlParts(base, ctx) : [];
  const joined = join === "reference" ? resolveReference(baseParts, pathParts) : joinParts(baseParts, pathParts);
  return partsToUrlShape(joined, { envHints: ctx.envHints });
}

const HTTP_METHOD = /^(?:get|post|put|patch|delete|head|options|trace)$/i;

/** `HttpMethod.POST` (Spring), `HttpMethod.Post` (Ktor), `HTTPMethod.POST`: an enum constant named after the method. */
function methodConstant(s: Scoped, ctx: IrCtx): string | undefined {
  const d = deref(s.expr, s.fn, ctx).expr;
  const name = d.k === "attr" ? d.name : d.k === "qname" ? d.path[d.path.length - 1] : undefined;
  return name && HTTP_METHOD.test(name) ? name.toUpperCase() : undefined;
}

function resolveMethod(raw: IrRaw, ctx: IrCtx, dynamic: DynamicPart[]): string {
  if (raw.impliedMethod) return raw.impliedMethod.toUpperCase();
  return raw.method ? methodOf(raw.method, ctx, dynamic) : "GET";
}

function methodOf(method: Scoped, ctx: IrCtx, dynamic: DynamicPart[]): string {
  const constant = methodConstant(method, ctx);
  if (constant) return constant;
  const parts = urlParts(method, ctx);
  const text = staticText(parts);
  if (text !== undefined) return text.toUpperCase() || "GET";
  const d = parts.find((p): p is Exclude<Part, { kind: "static" }> => p.kind !== "static");
  dynamic.push({ where: "method", name: d ? d.name : "method", origin: !d ? "unknown" : d.kind === "env" ? "env" : d.origin });
  return "DYNAMIC";
}

/** `params` sources: `arg:N` (or the keyword named like the placeholder), `kw:name`, `instance:N`, `seg:name:N`, `chain:a,b`. */
function sdkParam(m: IrSdkMatch, source: string, name: string, ctx: IrCtx): { expr?: Scoped; parts?: Part[] } | undefined {
  const before = m.segs.slice(0, -1);
  const chain = /^chain:([\w,]+)$/.exec(source);
  if (chain) {
    const names = new Set(chain[1]!.split(","));
    const segs = before.filter((s) => s.call && names.has(s.name));
    // a root reference first (`getReference()` with no argument, then `child(path)`) adds nothing to the path
    while (segs.length > 1 && segs[0]!.call!.args.length === 0) segs.shift();
    const pieces = segs.map((s) => argOf(s, 0));
    if (pieces.length === 0 || pieces.some((p) => !p)) return {};
    return { parts: pieces.flatMap((p, i) => [...(i ? [{ kind: "static", text: "/" } as Part] : []), ...urlParts(p!, ctx)]) };
  }
  const seg = /^seg:(\w+):(\d+)$/.exec(source);
  if (seg) return { expr: argOf([...before].reverse().find((s) => s.name === seg[1]), Number(seg[2]), name) };
  const m2 = /^(arg|kw|instance):(\w+)(?:\.(\w+))?$/.exec(source);
  if (!m2) return undefined;
  const target = m2[1] === "instance" ? before[before.length - 1] : m.method;
  const base = m2[1] === "kw" ? argOf(target, undefined, m2[2]) : argOf(target, Number(m2[2]), name);
  if (m2[3]) return { expr: propOf(base, m2[3], ctx) };
  // a JVM path id given inside the params object (`retrieve(FileRetrieveParams.builder().fileId(id).build())`)
  return { expr: (m.entry.setters && m2[1] === "arg" ? propOf(base, name, ctx) : undefined) ?? base };
}

/** The method an SDK request object was given (`methodFrom`), when the code sets one. */
function sdkMethod(raw: IrRaw, ctx: IrCtx, dynamic: DynamicPart[]): string | undefined {
  const m = raw.sdk!;
  const from = m.spec.methodFrom ? sdkParam(m, m.spec.methodFrom, "method", ctx)?.expr : undefined;
  return from ? methodOf(from, ctx, dynamic) : undefined;
}

function sdkSource(raw: IrRaw, ctx: IrCtx): SdkSource<Scoped> {
  const m = raw.sdk!;
  return {
    spec: m.spec,
    host: m.spec.host ?? m.entry.host,
    inlinePath: m.entry.inlinePathLiterals,
    basePath: m.entry.basePath,
    baseUrl: raw.baseUrl?.expr.k === "null" ? undefined : raw.baseUrl,
    envHints: ctx.envHints,
    evaluate: (s) => urlParts(s, ctx),
    urlParts: (s) => baseUrlParts(s, ctx, m.spec.path.startsWith("/")),
    // `model`: the call's model fills the placeholder (a deployment or model id in the path, Spring AI's Bedrock)
    param: (source, name) => (source === "model" ? (raw.model ? { expr: raw.model } : {}) : sdkParam(m, source, name, ctx)),
    arg: (i, name) => argOf(m.method, i, name),
    bodyProp: (name) => propOf(raw.body, name, ctx) ?? argAt(m.method, `kw:${name}`, ctx),
  };
}

function defaultEncoding(raw: IrRaw, method: string): BodyEncoding {
  if (raw.encoding) return raw.encoding;
  if (raw.sdk?.spec.encoding) return raw.sdk.spec.encoding;
  if (!raw.body && (method === "GET" || method === "HEAD")) return "none";
  return "json";
}

function authOf(raw: IrRaw, fromHeaders: AuthScheme): AuthScheme {
  const definite = fromHeaders !== "none" && fromHeaders !== "unknown";
  // a GraphQL client's headers are the code's; credentials it sets elsewhere stay unknown
  if (raw.sdk && (!raw.sdk.entry.endpoint || !definite)) return raw.sdk.spec.auth ?? raw.sdk.entry.auth ?? "unknown";
  return definite || !raw.auth ? fromHeaders : raw.auth;
}

/** The GraphQL document an SDK method takes (`client.execute(gql("..."))`); one it is not given is unknown. */
function documentOf(raw: IrRaw, ctx: IrCtx): Shape | undefined {
  const m = raw.sdk;
  if (m?.spec.documentArg === undefined) return undefined;
  const arg = argOf(m.method, m.spec.documentArg, m.spec.documentKw ?? "document");
  if (!arg) return { type: "unknown" };
  const built = ctx.idx.lang.documentOf?.(arg, ctx);
  return built !== undefined ? { type: "string", enum: [built] } : shapeOf(arg.expr, arg.fn, ctx).shape;
}

/** The RPC method a JSON-RPC client library's method sends (#52), from its registry or the argument naming it. */
function rpcOperation(raw: IrRaw, ctx: IrCtx): Operation | undefined {
  const m = raw.sdk;
  if (!m || (m.spec.rpc === undefined && m.spec.rpcArg === undefined)) return undefined;
  const arg = m.spec.rpcArg !== undefined ? argAt(m.method, m.spec.rpcArg, ctx) : undefined;
  return rpcClientOperation(m.spec, arg ? shapeOf(arg.expr, arg.fn, ctx).shape : undefined);
}

/** Resolves a detected call into the report's Call records: one per operation it sends (a JSON-RPC batch), or one. */
export function buildIrCall(raw: IrRaw, base: BuildIrCtx): Call[] {
  const ctx = withSelf(withSubst(base, raw.subst), raw.self);
  const dynamic: DynamicPart[] = [];
  const target = raw.sdk ? sdkTarget(sdkSource(raw, ctx)) : undefined;
  const method = target ? (sdkMethod(raw, ctx, dynamic) ?? target.method) : resolveMethod(raw, ctx, dynamic);
  const soap = raw.soap ? irSoapTarget(raw.soap, raw.fn.module.file, ctx, base.rootDir) : undefined;
  // an SDK call to a URL the client was built with (`WebhookClient(url).send(...)`) goes there
  const url = soap ? soap.url : target && !raw.url ? target.url : resolveUrl(raw.url, raw.sdk ? undefined : raw.baseUrl, ctx, raw.urlJoin);
  dynamic.push(...url.dynamic);
  // GraphQL variables: the callers of the function they are written in are not searched (as in TypeScript)
  const body = resolveIrBody(raw.body, raw.bodyRole, defaultEncoding(raw, method), raw.sdk?.entry.endpoint ? { ...ctx, callerLevel: true } : ctx);
  if (raw.encoding && body.shape) body.encoding = raw.encoding;
  body.shape = wrapShape(body.shape, raw.sdk?.spec.bodyWrap);
  dynamic.push(...body.dynamic);
  if (raw.optionsOpaque && !raw.impliedMethod && !raw.method) dynamic.push({ where: "method", name: "options", origin: "unknown" });
  const q = resolveIrQuery(raw.query, ctx);
  const ownHeaders = !raw.sdk || !!raw.sdk.entry.endpoint;
  const headers: HeadersResult = ownHeaders ? resolveIrHeaders(raw.headers, ctx) : { names: [], values: {}, authScheme: "none", known: true };
  const pairs = raw.sdk ? undefined : resolvePairs(raw.pairs, ctx, headers, q);
  dynamic.push(...q.dynamic);
  const fromHeaders = headers.authScheme === "none" && pairs?.queryAuth ? pairs.queryAuth : headers.authScheme;
  const file = raw.fn.module.file;
  const sdk = raw.sdk;
  return assembleCalls({
    location: { file: relativePosix(base.rootDir, file), line: raw.call.pos.line, col: raw.call.pos.col, language: raw.fn.module.language ?? base.language },
    client: raw.client,
    sdk: sdk ? { package: sdk.entry.package, version: base.sdkVersion(file, sdk.entry.package), chain: sdk.key, provider: sdk.entry.provider, operationId: sdk.spec.operationId } : undefined,
    url,
    method,
    dynamic,
    body,
    headers: { names: headers.names, values: headers.values, alternatives: headers.alternatives, authScheme: authOf(raw, fromHeaders) },
    query: { names: q.names, shape: q.shape },
    via: raw.via,
    codeBaseUrl: !!raw.baseUrl,
    optionsOpaque: raw.optionsOpaque,
    model: raw.model ? shapeOf(raw.model.expr, raw.model.fn, ctx).shape : undefined,
    document: documentOf(raw, ctx),
    operation: soap?.operation ?? rpcOperation(raw, ctx),
    routeByModel: sdk?.entry.routeByModel,
    clientParts: pairs?.clientParts,
    clientFrom: raw.clientFrom,
  });
}
