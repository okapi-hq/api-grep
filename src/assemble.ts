import { createHash } from "node:crypto";
import { bodySourceOf, score } from "./confidence.js";
import { resolveProvider, type ResolvedProvider } from "./normalize/provider.js";
import type { Call, ClientKind } from "./report/schema.js";
import type { BodyResult } from "./resolve/body.js";
import { isNullable } from "./resolve/type-shape.js";
import { withoutCredentialLiterals } from "./secrets.js";
import type { AuthScheme, DynamicPart, Shape, UrlShape } from "./types.js";

/** A call resolved by a language front end: everything the report needs, before provider and confidence. */
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
  headers: { names: string[]; values: Record<string, string | null>; authScheme: AuthScheme };
  query: { names: string[]; shape: Record<string, Shape> };
  via?: string;
  /** The code gives the SDK client its own base URL (`new OpenAI({ baseURL })`, `OpenAI(base_url=...)`). */
  codeBaseUrl?: boolean;
  /** Options present but not resolvable to a literal: method and body may be wrong. */
  optionsOpaque?: boolean;
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

function confidenceOf(r: ResolvedCall): number {
  return score({
    sdkHit: !!r.sdk,
    hostKind: r.url.hostKind,
    envHinted: r.url.hostKind === "env" && !!r.url.host,
    pathDynamicNamed: !r.url.dynamic.some((d) => d.where === "path" && d.name === "expr"),
    bodySource: bodySourceOf(r.body.shape, r.body.fromType, r.body.fromLiteral),
    viaWrapper: !!r.via,
    specMatched: false,
    optionsOpaque: !!r.optionsOpaque,
  });
}

/** Hash of where the call is; the n-th other request made from the same place (through a wrapper) adds `#n`. */
export function callId(loc: Call["location"], n = 0): string {
  const key = `${loc.file}:${loc.line}:${loc.col}${n > 0 ? `#${n}` : ""}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 12);
}

/** The report's Call record: provider, confidence and id are decided here, the same way for every language. */
export function assembleCall(r: ResolvedCall): Call {
  const { provider, source: providerSource } = providerOf(r);
  const q = queryOf(r.url, r.query);
  const loc = r.location;
  return {
    id: callId(loc),
    location: loc,
    client: r.client,
    sdk: r.sdk ? { package: r.sdk.package, version: r.sdk.version, chain: r.sdk.chain } : undefined,
    framework: r.framework,
    provider,
    providerSource,
    host: r.url.host,
    hostKind: r.url.hostKind,
    envName: r.url.envName,
    scheme: r.url.scheme,
    method: r.method,
    pathTemplate: r.url.pathTemplate,
    urlTemplate: r.url.raw,
    operationId: r.sdk?.operationId,
    query: q.query,
    queryShape: q.queryShape,
    headers: r.headers.names,
    headerValues: r.headers.values,
    authScheme: r.headers.authScheme,
    body: withoutCredentialLiterals(r.body.shape),
    bodyFromType: r.body.fromType,
    bodyEncoding: r.body.shape ? r.body.encoding : "none",
    dynamic: r.dynamic,
    via: r.via,
    confidence: confidenceOf(r),
    findings: [],
    examples: [],
  };
}
