import { createHash } from "node:crypto";
import { modelOf, type ModelFact } from "./model/fact.js";
import { routeOf, routePath, splitModel } from "./model/route.js";
import { resolveProvider, type ResolvedProvider } from "./normalize/provider.js";
import { operationsOf } from "./operation/index.js";
import type { BodySource, Call, ClientFrom, ClientKind, ClientPart, Operation } from "./report/schema.js";
import type { BodyResult } from "./resolve/body.js";
import { isNullable } from "./resolve/type-shape.js";
import { isXmlContentType } from "./resolve/xml-shape.js";
import { withoutCredentialLiterals } from "./secrets.js";
import type { AuthScheme, DynamicPart, Shape, UrlShape } from "./types.js";

/** A call resolved by a language front end: everything the report needs, before provider and id. */
export interface ResolvedCall {
  /** File, line, column and language of the call. */
  location: Call["location"];
  client: ClientKind;
  sdk?: { package: string; version?: string; chain: string; provider: string; operationId?: string };
  framework?: string;
  url: UrlShape;
  method: string;
  /** Every dynamic part (method, URL, body, query), in report order. */
  dynamic: DynamicPart[];
  body: BodyResult;
  headers: { names: string[]; values: Record<string, string | null>; alternatives?: Record<string, string[]>; authScheme: AuthScheme };
  query: { names: string[]; shape: Record<string, Shape> };
  via?: string;
  /** The code gives the SDK client its own base URL (`new OpenAI({ baseURL })`, `OpenAI(base_url=...)`). */
  codeBaseUrl?: boolean;
  /** Options present but not readable as an object literal: method, headers or body may be missing. */
  optionsOpaque?: boolean;
  /** The model value when the request carries it outside the body (`openai("gpt-4o")`, an agent's `model`). */
  model?: Shape;
  /** The library picks the provider from the model name (LiteLLM, PydanticAI, DSPy): host and path follow it. */
  routeByModel?: boolean;
  /** A GraphQL document an SDK method takes apart from its body (Octokit `graphql(query, variables)`). */
  document?: Shape;
  /** The operation when the URL does not name it (JSON-RPC `method`, GraphQL document, SOAP action, `Action=`). */
  operation?: Operation;
  /** Query parameters and headers the client adds to every request (interceptors, client defaults). */
  clientParts?: ClientPart[];
  /** The SDK client is an untyped parameter: found through the callers, or the one declared SDK with that method. */
  clientFrom?: ClientFrom;
}

function queryOf(url: UrlShape, q: ResolvedCall["query"]): { query: string[]; queryShape?: Shape } {
  const properties = { ...url.queryShape, ...q.shape };
  const query = [...new Set([...url.query, ...q.names])];
  if (query.length === 0) return { query };
  const required = query.filter((k) => !(properties[k] && isNullable(properties[k])));
  return { query, queryShape: withoutCredentialLiterals({ type: "object", properties, required }) };
}

/**
 * The SDK's provider, unless the code points the client at another known service: `new OpenAI({ baseURL:
 * "https://openrouter.ai/api/v1" })` talks to OpenRouter, a local `:11434` to Ollama.
 */
function providerOf(r: ResolvedCall): ResolvedProvider {
  const fromUrl = resolveProvider({ hostKind: r.url.hostKind, host: r.url.host, envName: r.url.envName });
  if (r.sdk && r.codeBaseUrl && fromUrl.source && fromUrl.provider !== r.sdk.provider) return fromUrl;
  return r.sdk ? { provider: r.sdk.provider, source: "sdk" } : fromUrl;
}

/** Where the body shape came from: an object literal, a declared type, a value that could not be read, or no body. */
export function bodySourceOf(body: BodyResult): BodySource {
  const { shape, fromType, fromLiteral } = body;
  if (!shape) return "none";
  if (shape.type === "dynamic" || shape.type === "unknown") return "unknown";
  if (fromLiteral) return "literal";
  if (fromType || shape.type === "object") return "type";
  return "literal";
}

/**
 * Hash of where the call is and of the operation it names (two JSON-RPC methods sent from one helper are two
 * endpoints); the n-th other request made from the same place (through a wrapper) adds `#n`. A call with no operation
 * name hashes its place only, so its id stays what it was before operations were reported.
 */
export function callId(loc: Call["location"], n = 0, operation?: string | null): string {
  const key = `${loc.file}:${loc.line}:${loc.col}${n > 0 ? `#${n}` : ""}${operation ? ` ${operation}` : ""}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 12);
}

function modelFact(r: ResolvedCall): ModelFact | undefined {
  return modelOf({ model: r.model, body: r.body.shape, pathTemplate: r.url.pathTemplate, dynamic: r.dynamic });
}

/** A routed call's model names as the provider receives them: `anthropic/claude-sonnet-4` is `claude-sonnet-4`. */
function unprefixed(model: ModelFact): ModelFact {
  return { ...model, values: [...new Set(model.values.map((v) => splitModel(v).model))] };
}

/**
 * A call whose library routes by model name goes where its first name routes (`anthropic/claude-sonnet-4` to
 * api.anthropic.com/v1/messages); with no name it can route, its provider stays unknown.
 */
function routed(r: ResolvedCall, model: ModelFact | undefined): Pick<Call, "provider" | "host" | "hostKind" | "pathTemplate" | "urlTemplate"> | undefined {
  if (!r.routeByModel || r.codeBaseUrl) return undefined;
  const name = model?.values[0];
  const route = name ? routeOf(name) : undefined;
  if (!route) return { provider: "unknown", host: undefined, hostKind: "unknown", pathTemplate: r.url.pathTemplate, urlTemplate: r.url.raw };
  const path = (routePath(route, r.sdk?.operationId) ?? r.url.pathTemplate).replace("{model}", encodeURIComponent(splitModel(name!).model));
  return { provider: route.provider, host: route.host, hostKind: "literal", pathTemplate: path, urlTemplate: `https://${route.host}${path}` };
}

/** The report's Call record: provider and id are decided here, the same way for every language. */
export function assembleCall(r: ResolvedCall): Call {
  const { provider } = providerOf(r);
  const q = queryOf(r.url, r.query);
  const loc = r.location;
  const model = modelFact(r);
  const route = routed(r, model);
  const call: Call = {
    id: callId(loc, 0, r.operation?.name),
    location: loc,
    client: r.client,
    sdk: r.sdk ? { package: r.sdk.package, version: r.sdk.version, chain: r.sdk.chain } : undefined,
    framework: r.framework,
    provider,
    host: r.url.host,
    hostKind: r.url.hostKind,
    envName: r.url.envName,
    scheme: r.url.scheme,
    method: r.method,
    pathTemplate: r.url.pathTemplate,
    urlTemplate: r.url.raw,
    operationId: r.sdk?.operationId,
    operation: r.operation,
    query: q.query,
    queryShape: q.queryShape,
    headers: r.headers.names,
    headerValues: r.headers.values,
    ...(r.headers.alternatives && Object.keys(r.headers.alternatives).length > 0 ? { headerAlternatives: r.headers.alternatives } : {}),
    authScheme: r.headers.authScheme,
    body: withoutCredentialLiterals(r.body.shape),
    bodyFromType: r.body.fromType,
    bodyEncoding: r.body.shape ? r.body.encoding : "none",
    dynamic: r.dynamic,
    via: r.via,
    optionsOpaque: !!r.optionsOpaque,
    bodySource: bodySourceOf(r.body),
    examples: [],
    ...(model ? { model: route ? unprefixed(model) : model } : {}),
    ...(r.clientParts?.length ? { clientParts: r.clientParts } : {}),
    ...(r.clientFrom ? { clientFrom: r.clientFrom } : {}),
  };
  return route ? { ...call, ...route } : call;
}

/**
 * A body sent with an XML content type (`text/xml`, `application/soap+xml`) is XML, whatever value carries it (a
 * variable the scan cannot read, a builder's output). A body read as an object or an array keeps its encoding.
 */
function withXmlEncoding(r: ResolvedCall): ResolvedCall {
  const { shape, encoding } = r.body;
  if (encoding === "xml" || encoding === "multipart" || encoding === "none" || !isXmlContentType(r.headers.values["content-type"])) return r;
  if (!shape || shape.type === "object" || shape.type === "array") return r;
  return { ...r, body: { ...r.body, encoding: "xml" } };
}

/**
 * The report's calls for one resolved request: one per operation it sends (each method of a JSON-RPC batch), or one
 * when it names none. An operation the front end set itself is kept as it is.
 */
export function assembleCalls(resolved: ResolvedCall): Call[] {
  const r = withXmlEncoding(resolved);
  const ops = r.operation ? [r.operation] : operationsOf(r);
  return ops.length === 0 ? [assembleCall(r)] : ops.map((operation) => assembleCall({ ...r, operation }));
}
