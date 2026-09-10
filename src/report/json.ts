import { redact } from "./redact.js";
import { type Report, ReportSchema } from "./schema.js";

/**
 * Validates, redacts and serializes a report. Redaction count is folded into stats.
 * The report's own `commit` hash is metadata, not a scanned value, so it is kept out
 * of the redaction walk (a 40-hex SHA otherwise matches the generic hex-secret rule).
 */
export function toJson(report: Report, pretty = true): string {
  const { commit, ...rest } = report;
  const { value, count } = redact(rest);
  value.stats.redacted = count;
  const parsed = ReportSchema.parse({ ...value, commit });
  return JSON.stringify(parsed, null, pretty ? 2 : undefined);
}
