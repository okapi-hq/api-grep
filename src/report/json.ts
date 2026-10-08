import { redact } from "./redact.js";
import { type Report, ReportSchema } from "./schema.js";
import { splitValid } from "./valid.js";

/**
 * Validates, redacts and serializes a report. Redaction count is folded into stats.
 * The report's own `commit` hash is metadata, not a scanned value, so it is kept out
 * of the redaction walk (a 40-hex SHA otherwise matches the generic hex-secret rule).
 * Calls are validated one by one: a call that does not fit the schema is dropped, listed
 * in `diagnostics.droppedCalls` and reported through `onWarning`; the rest is still written.
 */
export function toJson(report: Report, pretty = true, onWarning?: (message: string) => void): string {
  const { commit, ...rest } = report;
  const { value, count } = redact(rest);
  value.stats.redacted = count;
  const { valid, dropped } = splitValid(value.calls);
  if (dropped.length > 0) {
    value.stats.callsFound = valid.length;
    for (const d of dropped) onWarning?.(`dropped call at ${d.file}:${d.line}: ${d.detail}`);
    if (value.diagnostics) {
      value.diagnostics.droppedCalls.push(...dropped);
      value.diagnostics.complete = false;
    }
  }
  const parsed = ReportSchema.parse({ ...value, calls: valid, commit });
  return JSON.stringify(parsed, null, pretty ? 2 : undefined);
}
