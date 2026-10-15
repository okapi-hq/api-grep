import { z } from "zod";
import type { Shape } from "../types.js";
import { CoverageSchema, DiagnosticsSchema, LanguageSchema } from "./schema-scan.js";

/**
 * The report contract. `schema/report.v1.json` is generated from these schemas (`pnpm gen:schema`): every
 * `describe` / `meta` here is documentation other tools read. Additive changes bump the minor version, anything
 * that can break a reader bumps the major and moves the JSON Schema to `report.v<major>.json`.
 */
export const SCHEMA_VERSION = "1.22.0";
export const SCHEMA_URL = "https://raw.githubusercontent.com/okapi-hq/api-grep/main/schema/report.v1.json";

/** HTTP clients per language; `sdk` and `framework` are shared. */
export const ClientSchema = z
  .enum([
    "fetch",
    "axios",
    "got",
    "ky",
    "node-http",
    "jquery",
    "xhr",
    "html-form",
    "requests",
    "httpx",
    "aiohttp",
    "urllib",
    "urllib3",
    "guzzle",
    "laravel-http",
    "symfony-http",
    "curl",
    "psr-18",
    "php-stream",
    "wordpress",
    "okhttp",
    "java-http",
    "ktor",
    "spring-rest",
    "spring-webclient",
    "feign",
    "retrofit",
    "apache-httpclient",
    "jaxrs-client",
    "async-http-client",
    "unirest",
    "vertx-webclient",
    "node-soap",
    "zeep",
    "php-soap",
    "net-http",
    "resty",
    "wget",
    "httpie",
    "sdk",
    "framework",
  ])
  .meta({
    id: "Client",
    description:
      "How the request is sent. TypeScript and JavaScript: fetch, axios, got, ky, node-http, jquery ($.ajax, $.get, $.post), xhr (XMLHttpRequest), node-soap (a SOAP client of the soap package). HTML: html-form (a form submitted to its action URL). Python: requests, httpx, aiohttp, urllib (urllib.request), urllib3, zeep (a zeep SOAP client). PHP: guzzle, laravel-http (the Http facade), symfony-http (HttpClient), curl, psr-18 (a PSR-7 request sent by any PSR-18 client), php-stream (file_get_contents / fopen on a URL), wordpress (wp_remote_*), php-soap (the SoapClient of the soap extension). Kotlin and Java: okhttp, java-http (java.net.http HttpClient and HttpURLConnection), ktor (Ktor client), spring-rest (RestTemplate, RestClient), spring-webclient (WebClient), feign (an OpenFeign interface method), retrofit (a Retrofit service interface method), apache-httpclient (Apache HttpClient 4 and 5: classic, async and fluent), jaxrs-client (the JAX-RS client: Jersey, RESTEasy), async-http-client (AsyncHttpClient), unirest (Unirest), vertx-webclient (the Vert.x WebClient). Go: net-http (net/http: http.Get / Post / PostForm, a http.Client, a request built with http.NewRequest; also the fhttp fork and go-retryablehttp, which keep its API), resty (go-resty). Shell: curl (the curl command), wget, httpie (HTTPie's http and https commands). Any language: sdk (a registry), framework (a framework helper).",
  });

export const ShapeSchema: z.ZodType<Shape> = z
  .lazy(() =>
    z.union([
      z.object({
        type: z.literal("object"),
        properties: z.record(z.string(), ShapeSchema),
        required: z.array(z.string()),
        dynamicKeys: z.boolean().optional().describe("Some keys are computed and not listed."),
        fromType: z.string().optional(),
      }),
      z.object({ type: z.literal("array"), items: ShapeSchema, fromType: z.string().optional() }),
      z.object({
        type: z.enum(["string", "number", "integer", "boolean", "null"]),
        enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional().describe("Literal values seen in the code."),
        fromType: z.string().optional(),
        hint: z.string().optional().describe("Source identifier the value came from (`email`), used to synthesize examples."),
        env: z
          .string()
          .optional()
          .describe("Environment variable the value is read from; `enum` then holds the default the code gives, if any (`os.getenv(\"MODEL\", \"gpt-4o\")`)."),
      }),
      z.object({ type: z.literal("union"), anyOf: z.array(ShapeSchema), fromType: z.string().optional() }),
      z.object({
        type: z.literal("dynamic"),
        origin: z.enum(["param", "call", "env", "unknown"]).describe("Where the value comes from: a parameter, a call result, an env var, or unknown."),
        hint: z.string().optional(),
      }),
      z.object({ type: z.literal("unknown") }),
    ]),
  )
  .meta({
    id: "Shape",
    description: "Shape of a value: names and types, never data. `fromType` is the TypeScript type it was read from. Close to JSON Schema, plus `dynamic` and `unknown`.",
  });

const EncodingSchema = z
  .enum(["json", "form", "multipart", "raw", "xml", "none"])
  .describe("How the body is encoded: json, form (urlencoded), multipart, raw (bytes or text), xml (an XML document, SOAP envelopes included), or none.");

export const BODY_SOURCES = ["literal", "type", "unknown", "none"] as const;
export type BodySource = (typeof BODY_SOURCES)[number];

export const ExampleSchema = z
  .object({
    variant: z.enum(["minimal", "full", "alt"]).describe("minimal: required properties. full: adds optional ones. alt: other enum values, union branches and booleans."),
    method: z.string(),
    url: z.string().describe("Concrete URL; an unresolved host stays visible (`https://{baseUrl}/...`)."),
    headers: z.record(z.string(), z.string()).describe("Credentials are `<name>` placeholders, never values."),
    query: z.record(z.string(), z.string()),
    body: z.unknown().optional(),
    bodyEncoding: EncodingSchema,
  })
  .meta({ id: "Example", description: "A concrete request synthesized from the call: invented values, stable across runs." });

export const LocationSchema = z
  .object({
    file: z.string().describe("Path relative to the scanned directory, `/` separated."),
    line: z.number().describe("1-based line of the call."),
    col: z.number().describe("1-based column of the call."),
    language: LanguageSchema,
  })
  .meta({ id: "Location", description: "Where the call is in the source." });

export const DynamicPartSchema = z
  .object({
    where: z.enum(["path", "query", "body", "method", "host"]),
    name: z.string().describe("Placeholder name, as in `{name}` in `pathTemplate`."),
    origin: z.string().describe("param, call, env, sdk or unknown."),
    shape: ShapeSchema.optional(),
  })
  .meta({ id: "DynamicPart", description: "Part of the request the scan could not know statically." });

export const ModelSchema = z
  .object({
    values: z
      .array(z.string())
      .describe("Model names the code gives, literally or as a default (an environment variable's, a function's returns, every branch of a condition)."),
    env: z.string().optional().describe("Environment variable the model is read from; `values` holds its default in the code, if any."),
    envExample: z
      .string()
      .optional()
      .describe("The value the repository's example env file nearest the call (`.env.example`, `.env.sample`, …) gives `env`; not a value the code gives."),
    dynamic: z.boolean().describe("Some value could not be read statically (a parameter, a call result): `values` may be incomplete."),
    hint: z.string().optional().describe("Identifier the unread value comes from (`get_model`, `settings.model`)."),
    from: z
      .enum(["body", "path", "argument"])
      .describe("Where the request carries it: a body property (`model`, `modelId`), a path segment (`/models/{model}`), or an SDK argument that is not the body (`openai(\"gpt-4o\")`)."),
  })
  .meta({ id: "Model", description: "The model a call names, as far as the code tells statically." });

/** A selected field's arguments by name: literal values as JSON, variables as `"$name"`. */
const GraphqlArgumentsSchema = z.record(z.string(), z.unknown());

export const OperationSchema = z
  .object({
    protocol: z
      .enum(["json-rpc", "graphql", "soap", "action"])
      .describe("The protocol that names the operation. action: an action-style API that names the operation in a query or form parameter (AWS Query `Action=`, Flickr `method=`)."),
    name: z
      .string()
      .nullable()
      .describe(
        "The operation: `getTransaction` (JSON-RPC `method`), `GetOrder` (GraphQL; the root fields of an anonymous operation), `Track` (SOAP action), `DescribeInstances` (`Action=`). With `dynamic`, the literal parts with a `{placeholder}` for the rest (`eth_{kind}`); null when no part is known.",
      ),
    type: z.enum(["query", "mutation", "subscription"]).optional().describe("GraphQL only: the operation type."),
    fields: z
      .array(z.string())
      .optional()
      .describe("GraphQL only: the selected field paths from the root, aliases resolved and fragments inlined (`order.id`, `order.customer.email`)."),
    arguments: z
      .record(z.string(), z.union([GraphqlArgumentsSchema, z.array(GraphqlArgumentsSchema)]))
      .optional()
      .describe(
        "GraphQL only: the arguments of selected fields, by field path as in `fields` (`{ \"orders\": { \"first\": 10, \"sortKey\": \"CREATED_AT\" } }`). A literal is its JSON value (an enum value its name), a variable `\"$name\"`; a path that aliases select with different arguments has a list of them. Absent when no selected field has arguments, or past the bounds.",
      ),
    alternatives: z.array(z.string()).optional().describe("Every name the call can send when a branch picks one, `name` first."),
    batch: z
      .boolean()
      .optional()
      .describe("Sent in one request together with other operations (a JSON-RPC array): each operation is a call of its own at the same location."),
    dynamic: z.boolean().describe("Part of the name is not known statically (computed, or a branch the scan could not read)."),
    from: z
      .enum(["body", "header", "query", "document"])
      .describe("Where the request carries the name: a body property or element, a header (`SOAPAction`), a query parameter, or a GraphQL document."),
  })
  .meta({ id: "Operation", description: "The operation a call performs when its URL does not name it: JSON-RPC, GraphQL, SOAP and action-style APIs send every operation to one URL." });

export const ClientPartSchema = z
  .object({
    where: z.enum(["query", "header"]),
    name: z.string().describe("Query parameter name, or header name in lower case, as listed in `query` / `headers`."),
    from: z
      .enum(["interceptor", "default"])
      .describe("interceptor: an interceptor of the client (OkHttp `addInterceptor`). default: a default the client is built with (Ktor `defaultRequest`, Spring `defaultHeader`)."),
    optional: z
      .boolean()
      .optional()
      .describe(
        "true: added on some requests only (set in a branch or a loop of the interceptor, or after an early return: `if (url.contains(...)) builder.header(...)`). Absent when added to every request.",
      ),
  })
  .meta({ id: "ClientPart", description: "A query parameter or header the client adds to every request it sends, rather than the call itself." });

export const ClientFromSchema = z
  .enum(["caller", "manifest"])
  .meta({
    id: "ClientFrom",
    description:
      "Where the SDK client of a call made on an untyped parameter (`def ask(client, prompt)`, `c: any`) was found. caller: the argument the function's callers in the repository pass, one call per distinct client. manifest: no caller passes a known client, and exactly one SDK the manifests declare has that method.",
  });

export const CallSchema = z
  .object({
    id: z
      .string()
      .describe("Stable id: a hash of file, line and column, and of `operation.name` when there is one. Each other request made from the same place (through a wrapper) adds its index."),
    location: LocationSchema,
    client: ClientSchema,
    sdk: z
      .object({
        package: z.string(),
        version: z.string().optional().describe("Version range from the nearest manifest (package.json, requirements file, pyproject.toml...)."),
        chain: z.string().describe("Method called on the client (`customers.create`)."),
      })
      .optional()
      .describe("Set when client is sdk."),
    framework: z.string().optional().describe("Framework helper (n8n, activepieces, ...), when client is framework."),
    provider: z
      .string()
      .describe("Provider id from `api-grep providers` (`stripe`), or `internal` (relative URL, localhost), `env:<NAME>` or `unknown`."),
    host: z.string().optional().describe("Host, possibly with placeholders (`{project}.supabase.co`). Absent when unknown."),
    hostKind: z.enum(["literal", "const", "env", "relative", "unknown"]).describe("Where the host came from."),
    envName: z.string().optional().describe("Env var holding the base URL, when hostKind is env."),
    scheme: z.string().optional(),
    method: z.string().describe("HTTP method, upper case; `DYNAMIC` when it is not known statically."),
    pathTemplate: z.string().describe("Path with `{name}` placeholders for the dynamic segments."),
    urlTemplate: z.string().describe("Full URL template."),
    operationId: z.string().optional().describe("OpenAPI operation id, from the SDK registry."),
    operation: OperationSchema.optional().describe("The operation, for protocols that name it outside the URL; absent when the scan recognizes none."),
    query: z.array(z.string()).describe("Query parameter names."),
    queryShape: ShapeSchema.optional(),
    headers: z.array(z.string()).describe("Header names, lower case."),
    headerValues: z.record(z.string(), z.string().nullable()).default({}).describe("Literal header values; null for credentials and dynamic values."),
    headerAlternatives: z
      .record(z.string(), z.array(z.string()))
      .optional()
      .describe(
        "Headers that can take several values, each with every literal value the code gives (a parameter's default and the arguments its callers pass). `headerValues` holds the first one, or null when some value cannot be read.",
      ),
    authScheme: z.enum(["bearer", "apikey", "basic", "none", "unknown"]),
    body: ShapeSchema.optional(),
    bodyFromType: z.string().optional().describe("TypeScript type the body was read from."),
    bodyEncoding: EncodingSchema,
    dynamic: z.array(DynamicPartSchema),
    via: z.string().optional().describe("Wrapper chain the call went through (`wrapper:tlsFetch>doFetch`); the location is the outer call site."),
    optionsOpaque: z
      .boolean()
      .describe("The request's options are a value the scan could not read as an object literal (a variable, a call): method, headers or body may be missing."),
    bodySource: z
      .enum(BODY_SOURCES)
      .describe("Where the body shape came from: an object literal in the code, a declared type (TypeScript type, Python or PHP class), a value that could not be read, or no body."),
    examples: z.array(ExampleSchema).default([]),
    model: ModelSchema.optional().describe("The model the request names (LLM and other AI APIs); absent when it names none."),
    clientParts: z
      .array(ClientPartSchema)
      .optional()
      .describe("Which of `query` and `headers` the client adds rather than the call (an interceptor, a client default); absent when none."),
    clientFrom: ClientFromSchema.optional().describe("Set when the SDK client is an untyped parameter: where it was found. Absent when the code names the client."),
  })
  .meta({ id: "Call", description: "One outbound HTTP or SDK call found in the source." });

export const StatsSchema = z
  .object({
    filesScanned: z.number(),
    callsFound: z.number(),
    byLanguage: z.record(z.string(), z.number()).describe("Calls per source language."),
    byClient: z.record(z.string(), z.number()).describe("Calls per client."),
    byProvider: z.record(z.string(), z.number()).describe("Calls per provider."),
    byHostKind: z.record(z.string(), z.number()).describe("Calls per hostKind."),
    withBodyShape: z.number(),
    withDynamic: z.number(),
    redacted: z.number().describe("Secret-looking strings replaced with `<redacted>`."),
    durationMs: z.number(),
  })
  .meta({ id: "Stats", description: "Counts over `calls`." });

export const ReportSchema = z
  .object({
    $schema: z.string().describe("URL of this JSON Schema."),
    schemaVersion: z
      .string()
      .regex(/^1\.\d+\.\d+$/)
      .describe("Version of the report format. Readers check the major; minor versions only add fields and enum values."),
    tool: z.string(),
    version: z.string().describe("Version of the tool that wrote the report."),
    repo: z.string().optional().describe("Name of the scanned directory."),
    commit: z.string().optional().describe("HEAD commit of the scanned directory, when it is a git repository."),
    calls: z.array(CallSchema).describe("Sorted by file, line and column."),
    stats: StatsSchema,
    diagnostics: DiagnosticsSchema.optional(),
    coverage: CoverageSchema.optional(),
  })
  .meta({ title: "api-grep report", description: "Outbound HTTP and SDK calls found in a codebase by `api-grep scan --json`." });

export type Language = z.infer<typeof LanguageSchema>;
export type ClientKind = z.infer<typeof ClientSchema>;
export type ClientFrom = z.infer<typeof ClientFromSchema>;
export type Call = z.infer<typeof CallSchema>;
export type Example = z.infer<typeof ExampleSchema>;
export type Operation = z.infer<typeof OperationSchema>;
export type ClientPart = z.infer<typeof ClientPartSchema>;
export type Stats = z.infer<typeof StatsSchema>;
export type Report = z.infer<typeof ReportSchema>;
export * from "./schema-scan.js";
