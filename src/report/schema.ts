import { z } from "zod/v4";
import { CoverageSchema, DiagnosticsSchema } from "./schema-scan.js";

/**
 * The report contract. `schema/report.v1.json` is generated from these schemas (`pnpm gen:schema`): every
 * `describe` / `meta` here is documentation other tools read. Additive changes bump the minor version, anything
 * that can break a reader bumps the major and moves the JSON Schema to `report.v<major>.json`.
 */
export const SCHEMA_VERSION = "1.0.0";
export const SCHEMA_URL = "https://raw.githubusercontent.com/okapi-hq/api-grep/main/schema/report.v1.json";

export const LanguageSchema = z
  .enum(["typescript", "javascript", "python", "php"])
  .meta({ id: "Language", description: "Source language of a file, from its extension. The TypeScript scanner emits typescript and javascript." });

export const ShapeSchema: z.ZodType<unknown> = z
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

export const FindingSchema = z
  .object({
    rule: z.enum(["unknown-property", "missing-required", "type-mismatch", "deprecated", "enum-mismatch"]),
    severity: z.enum(["high", "medium", "low"]),
    property: z.string().describe("Dotted path of the property in the body."),
    message: z.string(),
    specRef: z.string().optional().describe("JSON pointer into the OpenAPI spec."),
  })
  .meta({ id: "Finding", description: "A mismatch between the body shape and the provider's OpenAPI spec (--specs --validate)." });

const EncodingSchema = z.enum(["json", "form", "multipart", "raw", "none"]);

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

export const CallSchema = z
  .object({
    id: z.string().describe("Stable id: a hash of file, line and column."),
    location: LocationSchema,
    client: z.enum(["fetch", "axios", "got", "ky", "node-http", "sdk", "framework"]).describe("How the request is sent."),
    sdk: z
      .object({
        package: z.string(),
        version: z.string().optional().describe("Version range from the nearest package.json."),
        chain: z.string().describe("Method called on the client (`customers.create`)."),
      })
      .optional()
      .describe("Set when client is sdk."),
    framework: z.string().optional().describe("Framework helper (n8n, activepieces, ...), when client is framework."),
    provider: z
      .string()
      .describe("Provider id from `apicalls providers` (`stripe`), or `internal` (relative URL, localhost), `env:<NAME>` or `unknown`."),
    providerSource: z.enum(["sdk", "host", "env-name"]).optional().describe("sdk: the SDK registry. host: a known host. env-name: only the env var's name."),
    host: z.string().optional().describe("Host, possibly with placeholders (`{project}.supabase.co`). Absent when unknown."),
    hostKind: z.enum(["literal", "const", "env", "relative", "unknown"]).describe("Where the host came from."),
    envName: z.string().optional().describe("Env var holding the base URL, when hostKind is env."),
    scheme: z.string().optional(),
    method: z.string().describe("HTTP method, upper case; `DYNAMIC` when it is not known statically."),
    pathTemplate: z.string().describe("Path with `{name}` placeholders for the dynamic segments."),
    urlTemplate: z.string().describe("Full URL template."),
    operationId: z.string().optional().describe("OpenAPI operation id, from the SDK registry or a matched spec."),
    query: z.array(z.string()).describe("Query parameter names."),
    queryShape: ShapeSchema.optional(),
    headers: z.array(z.string()).describe("Header names, lower case."),
    headerValues: z.record(z.string(), z.string().nullable()).default({}).describe("Literal header values; null for credentials and dynamic values."),
    authScheme: z.enum(["bearer", "apikey", "basic", "none", "unknown"]),
    body: ShapeSchema.optional(),
    bodyFromType: z.string().optional().describe("TypeScript type the body was read from."),
    bodyEncoding: EncodingSchema,
    dynamic: z.array(DynamicPartSchema),
    via: z.string().optional().describe("Wrapper chain the call went through (`wrapper:tlsFetch>doFetch`); the location is the outer call site."),
    confidence: z.number().min(0).max(1).describe("0 to 1. How sure the scan is of provider, URL and body."),
    findings: z.array(FindingSchema).default([]),
    examples: z.array(ExampleSchema).default([]),
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
    withFindings: z.number(),
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
  .meta({ title: "api-grep report", description: "Outbound HTTP and SDK calls found in a codebase by `apicalls scan --json`." });

export type Language = z.infer<typeof LanguageSchema>;
export type Call = z.infer<typeof CallSchema>;
export type Example = z.infer<typeof ExampleSchema>;
export type Stats = z.infer<typeof StatsSchema>;
export type Report = z.infer<typeof ReportSchema>;
export * from "./schema-scan.js";
