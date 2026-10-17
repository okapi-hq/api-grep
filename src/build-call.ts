import type { Expression } from "ts-morph";
import { assembleCalls, type ResolvedCall } from "./assemble.js";
import { getProp, toObjectLiteral } from "./ast/object.js";
import { relativePosix } from "./files.js";
import { languageOf } from "./language.js";
import { at } from "./detect/endpoint.js";
import { rpcClientOperation } from "./operation/json-rpc.js";
import { mcpOperation } from "./operation/mcp.js";
import type { Call, Operation } from "./report/schema.js";
import { resolveBody, shapeOf, type BodyResult } from "./resolve/body.js";
import { evaluate } from "./resolve/evaluate.js";
import { isAstDocument } from "./resolve/graphql-ast.js";
import { relayDocument } from "./resolve/relay-artifact.js";
import { refetchDocument } from "./resolve/relay-refetch.js";
import { stringShapeOf } from "./resolve/string-template.js";
import { addHeader } from "./resolve/header-names.js";
import { resolveHeaders } from "./resolve/headers.js";
import { paramAlternatives } from "./resolve/param-values.js";
import { staticText } from "./resolve/parts.js";
import { unionOf, wrapShape } from "./resolve/shape-utils.js";
import { withEdits } from "./resolve/edited-shape.js";
import { withFieldArgs } from "./resolve/field-args.js";
import { resolveMethod } from "./resolve/method.js";
import { resolveQuery } from "./resolve/query.js";
import { sdkUrl } from "./resolve/sdk-url.js";
import { soapClientCall } from "./resolve/soap-client.js";
import { withoutClientSettings } from "./model/client-settings.js";
import { asCandidates, withCandidates, type Choice } from "./resolve/choice.js";
import { partsToUrlShape, resolveUrl } from "./resolve/url.js";
import type { BodyEncoding, DynamicPart, EvalCtx, Part, RawCall, Shape, UrlShape } from "./types.js";

export interface BuildCtx extends EvalCtx {
  rootDir: string;
  sdkVersion: (file: string, pkg: string) => string | undefined;
}

function nodeHttpUrl(raw: RawCall, ctx: EvalCtx): UrlShape {
  const o = raw.nodeOpts!;
  const parts: Part[] = [{ kind: "static", text: `${o.scheme}://` }];
  const hostParts: Part[] = o.hostExpr ? evaluate(o.hostExpr, ctx) : [{ kind: "dynamic", name: "host", origin: "unknown" }];
  parts.push(...hostParts);
  if (o.portExpr) parts.push({ kind: "static", text: ":" }, ...evaluate(o.portExpr, ctx));
  const pathParts: Part[] = o.pathExpr ? evaluate(o.pathExpr, ctx) : [{ kind: "static", text: "/" }];
  parts.push(...pathParts);
  return partsToUrlShape(parts, ctx);
}

function defaultEncoding(raw: RawCall, method: string): BodyEncoding {
  if (raw.encoding) return raw.encoding;
  if (raw.sdk?.spec.encoding) return raw.sdk.spec.encoding;
  if (raw.bodyKey === "form") return "form";
  if (!raw.bodyExpr && (method === "GET" || method === "HEAD")) return "none";
  return "json";
}

function location(raw: RawCall, rootDir: string): Call["location"] {
  const sf = raw.node.getSourceFile();
  const { line, column } = sf.getLineAndColumnAtPos(raw.node.getStart());
  return { file: relativePosix(rootDir, sf.getFilePath()), line, col: column, language: languageOf(sf.getFilePath()) };
}

function resolveTarget(raw: RawCall, ctx: EvalCtx, dynamic: DynamicPart[]): { url: UrlShape; method: string } {
  if (raw.sdk) return sdkUrl(raw, ctx);
  const url = raw.nodeOpts ? nodeHttpUrl(raw, ctx) : resolveUrl(raw.urlExpr, ctx, raw.baseUrlExpr);
  const m = resolveMethod(raw.impliedMethod, raw.methodExpr, ctx);
  if (m.dynamic) dynamic.push(m.dynamic);
  return { url, method: m.method };
}

function resolveAuth(raw: RawCall, ctx: EvalCtx): ResolvedCall["headers"] {
  if (raw.sdk && !raw.sdk.anyHost) return { names: [], values: {}, authScheme: raw.sdk.auth ?? "unknown" };
  const call = resolveHeaders(raw.headersExpr, ctx);
  for (const [k, v] of raw.headerPairs ?? []) {
    const name = staticText(evaluate(k, ctx));
    if (name) addHeader(call, name, evaluate(v, ctx), paramAlternatives(v, ctx));
  }
  const inst = resolveHeaders(raw.instanceHeadersExpr, ctx);
  const definite = (s: Call["authScheme"]): boolean => s !== "none" && s !== "unknown";
  const fromHeaders = definite(call.authScheme) ? call.authScheme : inst.authScheme !== "none" ? inst.authScheme : call.authScheme;
  const authScheme = definite(fromHeaders) || !raw.authHint ? fromHeaders : raw.authHint;
  // a header the call sets replaces the instance's, alternatives included
  const alternatives = { ...Object.fromEntries(Object.entries(inst.alternatives ?? {}).filter(([k]) => !(k in call.values))), ...call.alternatives };
  // a GraphQL client's headers the scan does not see (an auth link, a `fetchOptions` callback) may carry credentials
  const scheme = raw.sdk && !definite(authScheme) ? (raw.sdk.auth ?? "unknown") : authScheme;
  return { names: [...new Set([...call.names, ...inst.names])], values: { ...inst.values, ...call.values }, alternatives, authScheme: scheme };
}

/** What names the operation in options holding the document (Apollo `{ query, variables }`, Octokit `{ query, ...vars }`). */
const DOCUMENT_KEYS = ["query", "mutation", "subscription", "document", "operationName", "extensions"];

/**
 * The GraphQL document an SDK method takes as an argument; one it is not given is unknown. Of options holding it,
 * only the keys naming the operation are read: the variables are the body's, and reading them here would search the
 * callers of the hook they are written in, a reference search the body leaves out.
 */
function documentOf(sdk: RawCall["sdk"], ctx: EvalCtx): Shape | undefined {
  const given = sdk?.spec.documentArg !== undefined ? sdk.args[sdk.spec.documentArg] : undefined;
  // the library's own document, unless the call gives one in its place (Hydrogen's `getCart(id, client, query)`)
  if (sdk?.spec.document !== undefined && !given) return { type: "string", enum: [sdk.spec.document] };
  if (sdk?.spec.documentArg === undefined) return undefined;
  const arg = sdk.spec.documentProp ? getProp(given, sdk.spec.documentProp, ctx) : given;
  if (!arg) return { type: "unknown" };
  if (sdk.spec.refetchQuery) return refetchDocument(shapeOf(arg, ctx).shape, arg);
  const artifact = relayDocument(arg);
  if (artifact) return stringShapeOf(artifact);
  const options = toObjectLiteral(arg, ctx);
  if (!options || isAstDocument(options)) return shapeOf(arg, ctx).shape;
  const properties: Record<string, Shape> = {};
  for (const key of DOCUMENT_KEYS) {
    const value = getProp(arg, key, ctx);
    if (value) properties[key] = shapeOf(value, ctx).shape;
  }
  return { type: "object", properties, required: [] };
}

/** The RPC method a JSON-RPC client library's method sends (#52), from its registry or the argument naming it; an MCP client's method. */
function rpcOperation(sdk: RawCall["sdk"], ctx: EvalCtx): Operation | undefined {
  if (!sdk) return undefined;
  const target = sdk.spec.targetArg !== undefined ? at(sdk.args, sdk.spec.targetArg) : undefined;
  const mcp = mcpOperation(sdk.spec, target ? shapeOf(target, ctx).shape : undefined);
  if (mcp) return mcp;
  if (sdk.spec.rpc === undefined && sdk.spec.rpcArg === undefined) return undefined;
  const arg = sdk.spec.rpcArg !== undefined ? at(sdk.args, sdk.spec.rpcArg) : undefined;
  return rpcClientOperation(sdk.spec, arg ? shapeOf(arg, ctx).shape : undefined);
}

const empty = (): Shape => ({ type: "object", properties: {}, required: [] });

/** Bodies a call may send (the variables of each call of a hook's loader, #102), as one shape of alternatives. */
function alternativeBodies(exprs: Expression[], ctx: EvalCtx): BodyResult {
  const each = exprs.map((e) => resolveBody(e, ctx, "json"));
  const names = new Set<string>();
  const dynamic = each.flatMap((b) => b.dynamic).filter((d) => !names.has(`${d.where}:${d.name}`) && !!names.add(`${d.where}:${d.name}`));
  return { shape: unionOf(each.flatMap((b) => (b.shape ? [b.shape] : []))), encoding: "json", dynamic, fromLiteral: each.every((b) => b.fromLiteral) };
}

/**
 * Resolves a RawCall into the report's Call records: one per operation it sends (a JSON-RPC batch), or one; one per
 * candidate host when its base URL is picked from a host table (`resolve/choice.ts`).
 */
export function buildCall(raw: RawCall, base: BuildCtx): Call[] {
  // the other requests of the call: at its place, through the same wrapper
  if (raw.also?.length) return [{ ...raw, also: undefined }, ...raw.also.map((r) => ({ ...r, node: raw.node, via: raw.via, subst: raw.subst ?? r.subst }))].flatMap((r) => buildCall(r, base));
  if (raw.alternatives?.length) return asCandidates([raw, ...raw.alternatives].map((r) => buildCall({ ...r, alternatives: undefined }, base)));
  return withCandidates((choice) => buildOne(raw, base, choice));
}

function buildOne(raw: RawCall, base: BuildCtx, choice: Choice): Call[] {
  // the URL records the host tables it reads; the rest (a model paired with the URL) reads the same entries
  const ctx: EvalCtx = { subst: raw.subst ?? base.subst, envHints: base.envHints, choice: { picks: choice.picks }, rootDir: base.rootDir };
  const dynamic: DynamicPart[] = [];
  const soap = raw.soap ? soapClientCall(raw.soap, raw.node.getSourceFile().getFilePath(), base.rootDir, ctx) : undefined;
  if (raw.soap && !soap) return [];
  const { url, method } = soap ? { url: soap.url, method: "POST" } : resolveTarget(raw, { ...ctx, choice }, dynamic);
  dynamic.push(...url.dynamic);
  // a GraphQL client's body is the operation's variables, values of the app: the callers of the hook or helper they
  // are written in are not searched for them, a reference search per function that the scan of a large app pays for
  const bodyCtx = raw.sdk?.anyHost ? { ...ctx, callerLevel: true } : ctx;
  let body = raw.bodyAlternatives ? alternativeBodies(raw.bodyAlternatives, bodyCtx) : resolveBody(raw.bodyExpr, bodyCtx, defaultEncoding(raw, method));
  if (raw.sdk?.spec.clientKwargs) body.shape = withoutClientSettings(body.shape);
  if (raw.sdk?.spec.fieldArgs) body = withFieldArgs(body, raw.sdk.spec.fieldArgs, raw.sdk.args, bodyCtx, defaultEncoding(raw, method));
  // a record sends the properties the code set on it (`product.title = t; product.save()`)
  if (raw.record && raw.sdk?.spec.record?.body) {
    body.shape = withEdits(empty(), raw.record.decl, raw.node, (e) => shapeOf(e, ctx), body.dynamic);
    body.encoding = "json";
  }
  body.shape = wrapShape(body.shape, raw.sdk?.spec.bodyWrap);
  dynamic.push(...body.dynamic);
  if (raw.optionsOpaque && !raw.impliedMethod && !raw.methodExpr) dynamic.push({ where: "method", name: "options", origin: "unknown" });
  const q = resolveQuery(raw.queryExpr, ctx);
  dynamic.push(...q.dynamic);
  const sdk = raw.sdk;
  return assembleCalls({
    location: location(raw, base.rootDir),
    client: raw.client,
    sdk: sdk
      ? { package: sdk.package, version: base.sdkVersion(raw.node.getSourceFile().getFilePath(), sdk.package), chain: sdk.chain, provider: sdk.provider, operationId: sdk.spec.operationId }
      : undefined,
    framework: raw.framework,
    url,
    method,
    dynamic,
    body,
    headers: resolveAuth(raw, ctx),
    query: { names: q.names, shape: q.shape },
    via: raw.via,
    codeBaseUrl: !!raw.baseUrlExpr,
    optionsOpaque: raw.optionsOpaque,
    model: raw.modelExpr ? shapeOf(raw.modelExpr, ctx).shape : undefined,
    document: documentOf(sdk, ctx),
    operation: soap?.operation ?? rpcOperation(sdk, ctx),
    routeByModel: sdk?.routeByModel,
    clientFrom: raw.clientFrom,
  });
}
