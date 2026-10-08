export { scan, computeStats, type ScanOptions } from "./scan.js";
export { toJson } from "./report/json.js";
export { toTable } from "./report/table.js";
export {
  ReportSchema,
  CallSchema,
  ShapeSchema,
  DiagnosticsSchema,
  CoverageSchema,
  SCHEMA_URL,
  SCHEMA_VERSION,
  type Report,
  type Call,
  type Stats,
  type Diagnostics,
  type Coverage,
  type Language,
} from "./report/schema.js";
export { reportJsonSchema } from "./report/json-schema.js";
export { languageOf } from "./language.js";
export { coverageWarnings, diagnosticsLine } from "./report/diagnostics.js";
export { sdkCoverage } from "./coverage.js";
export { Registry, defaultRegistry } from "./detect/registry/index.js";
export { evaluate, partsToTemplate } from "./resolve/evaluate.js";
export { PROVIDERS, providerForHost, providerFromEnvName, resolveProvider, type ProviderInfo, type ProviderSource } from "./normalize/provider.js";
export { resolveUrl, partsToUrlShape } from "./resolve/url.js";
export { resolveBody, shapeOf } from "./resolve/body.js";
export { resolveHeaders } from "./resolve/headers.js";
export { score, type Evidence } from "./confidence.js";
export { redact, looksSecret } from "./report/redact.js";
export { checkShape } from "./validate/check.js";
export { matchOperation } from "./validate/match.js";
export { SpecStore } from "./validate/spec-loader.js";
export type * from "./types.js";
