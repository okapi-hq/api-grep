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

export const CallSchema = z.object({
  id: z.string(),
  location: z.object({ file: z.string(), line: z.number(), col: z.number() }),
  client: z.enum(["fetch", "axios", "got", "ky", "node-http", "sdk"]),
  sdk: z.object({ package: z.string(), version: z.string().optional(), chain: z.string() }).optional(),
  provider: z.string(),
  host: z.string().optional(),
  hostKind: z.enum(["literal", "const", "env", "relative", "unknown"]),
  envName: z.string().optional(),
  method: z.string(),
  pathTemplate: z.string(),
  operationId: z.string().optional(),
  query: z.array(z.string()),
  headers: z.array(z.string()),
  authScheme: z.enum(["bearer", "apikey", "basic", "none", "unknown"]),
  body: ShapeSchema.optional(),
  bodyFromType: z.string().optional(),
  bodyEncoding: z.enum(["json", "form", "multipart", "raw", "none"]),
  dynamic: z.array(z.object({ where: z.enum(["path", "query", "body", "method", "host"]), name: z.string(), origin: z.string() })),
  via: z.string().optional(),
  confidence: z.number().min(0).max(1),
  findings: z.array(FindingSchema).default([]),
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
export type Stats = z.infer<typeof StatsSchema>;
export type Report = z.infer<typeof ReportSchema>;
