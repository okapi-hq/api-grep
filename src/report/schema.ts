import { z } from "zod";

export const ShapeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal("object"),
      properties: z.record(ShapeSchema),
      required: z.array(z.string()),
      dynamicKeys: z.boolean().optional(),
      fromType: z.string().optional(),
    }),
    z.object({ type: z.literal("array"), items: ShapeSchema, fromType: z.string().optional() }),
    z.object({
      type: z.enum(["string", "number", "integer", "boolean", "null"]),
      enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
      fromType: z.string().optional(),
      hint: z.string().optional(),
    }),
    z.object({ type: z.literal("union"), anyOf: z.array(ShapeSchema), fromType: z.string().optional() }),
    z.object({ type: z.literal("dynamic"), origin: z.enum(["param", "call", "env", "unknown"]), hint: z.string().optional() }),
    z.object({ type: z.literal("unknown") }),
  ]),
);

export const FindingSchema = z.object({
  rule: z.enum(["unknown-property", "missing-required", "type-mismatch", "deprecated", "enum-mismatch"]),
  severity: z.enum(["high", "medium", "low"]),
  property: z.string(),
  message: z.string(),
  specRef: z.string().optional(),
});

export const ExampleSchema = z.object({
  variant: z.enum(["minimal", "full", "alt"]),
  method: z.string(),
  url: z.string(),
  headers: z.record(z.string()),
  query: z.record(z.string()),
  body: z.unknown().optional(),
  bodyEncoding: z.enum(["json", "form", "multipart", "raw", "none"]),
});

export const CallSchema = z.object({
  id: z.string(),
  location: z.object({ file: z.string(), line: z.number(), col: z.number() }),
  client: z.enum(["fetch", "axios", "got", "ky", "node-http", "sdk", "framework"]),
  sdk: z.object({ package: z.string(), version: z.string().optional(), chain: z.string() }).optional(),
  framework: z.string().optional(),
  provider: z.string(),
  host: z.string().optional(),
  hostKind: z.enum(["literal", "const", "env", "relative", "unknown"]),
  envName: z.string().optional(),
  scheme: z.string().optional(),
  method: z.string(),
  pathTemplate: z.string(),
  urlTemplate: z.string(),
  operationId: z.string().optional(),
  query: z.array(z.string()),
  queryShape: ShapeSchema.optional(),
  headers: z.array(z.string()),
  headerValues: z.record(z.string().nullable()).default({}),
  authScheme: z.enum(["bearer", "apikey", "basic", "none", "unknown"]),
  body: ShapeSchema.optional(),
  bodyFromType: z.string().optional(),
  bodyEncoding: z.enum(["json", "form", "multipart", "raw", "none"]),
  dynamic: z.array(z.object({ where: z.enum(["path", "query", "body", "method", "host"]), name: z.string(), origin: z.string(), shape: ShapeSchema.optional() })),
  via: z.string().optional(),
  confidence: z.number().min(0).max(1),
  findings: z.array(FindingSchema).default([]),
  examples: z.array(ExampleSchema).default([]),
});

export const StatsSchema = z.object({
  filesScanned: z.number(),
  callsFound: z.number(),
  byClient: z.record(z.number()),
  byProvider: z.record(z.number()),
  byHostKind: z.record(z.number()),
  withBodyShape: z.number(),
  withDynamic: z.number(),
  withFindings: z.number(),
  redacted: z.number(),
  durationMs: z.number(),
});

export const ReportSchema = z.object({
  tool: z.string(),
  version: z.string(),
  repo: z.string().optional(),
  commit: z.string().optional(),
  calls: z.array(CallSchema),
  stats: StatsSchema,
});

export type Call = z.infer<typeof CallSchema>;
export type Example = z.infer<typeof ExampleSchema>;
export type Stats = z.infer<typeof StatsSchema>;
export type Report = z.infer<typeof ReportSchema>;
