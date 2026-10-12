import type { ClientKind } from "../../../report/schema.js";
import type { BodyEncoding } from "../../../types.js";
import type { ClientSpec, FluentMapSpec } from "../../ir/language.js";
import type { BuilderStep, StepTables } from "../../ir/steps.js";
import data from "./clients.json" with { type: "json" };

type Steps = Record<string, BuilderStep>;

/** A client sending requests built by a request builder (`newCall(request)`, `send(request, handler)`). */
export interface BuiltRequestClient {
  client: ClientKind;
  imports: string[];
  sends: Record<string, number>;
  starts: string[];
  request: Steps;
  interceptors?: string[];
  interceptor?: Steps;
}

/** A body wrapper (`json.toRequestBody(mediaType)`, `BodyPublishers.ofString(json)`): where its value and content type are. */
export interface BodyWrapper {
  value?: number | "receiver" | "content";
  contentType?: number | "media";
  none?: boolean;
}

/** A client whose request is a fluent chain on the client, ended by a terminal call (`webClient.post().uri(u).retrieve()`). */
export interface FluentClient {
  client: ClientKind;
  imports: string[];
  clients: string[];
  terminals: string[];
  clientSteps: Steps;
}

export interface KtorTables {
  client: ClientKind;
  imports: string[];
  clients: string[];
  verbs: Steps;
  defaults: string[];
  tables: StepTables;
}

export interface FeignTables {
  clients: string[];
  mappings: Record<string, string>;
  requestLine: string;
  headers: string;
  params: Record<string, "query" | "header" | "body" | "queryMap" | "headers">;
  targets: string[];
}

export interface RetrofitTables {
  annotations: string[];
  verbs: Record<string, string>;
  headers: string;
  form: string;
  multipart: string;
  params: Record<string, "path" | "query" | "queryMap" | "queryName" | "header" | "headers" | "body" | "field" | "fieldMap" | "part" | "partMap" | "url">;
  builders: string[];
  creates: string[];
  baseUrl: string[];
  client: string[];
  converter: string[];
  /** Converter factories and what they write: `scalars` writes strings and primitives as text, other types go on. */
  converters: Record<string, BodyEncoding | "scalars">;
  scalars: string[];
  rawBodies: string[];
}

export interface JvmTables {
  okhttp: BuiltRequestClient;
  javaHttp: BuiltRequestClient;
  urls: { starts: Steps; steps: Steps };
  bodies: Record<string, BodyWrapper>;
  contentTypes: { match: string; encoding: BodyEncoding }[];
  ktor: KtorTables;
  spring: FluentClient[];
  springRequest: Steps;
  springHeaders: Steps;
  restTemplate: ClientSpec;
  entities: string[];
  feign: FeignTables;
  retrofit: RetrofitTables;
  fluentMaps: FluentMapSpec[];
  constants: Record<string, string>;
}

export const JVM = data as unknown as JvmTables;

/** `application/json; charset=utf-8` -> json, `application/x-www-form-urlencoded` -> form. */
export function encodingOfType(text: string | undefined): BodyEncoding | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();
  return JVM.contentTypes.find((c) => lower.includes(c.match))?.encoding ?? "raw";
}
