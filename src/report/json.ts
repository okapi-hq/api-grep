import { redact } from "./redact.js";
import { type Report, ReportSchema } from "./schema.js";
import { validCalls } from "./valid.js";

/**
 * Validates, redacts and serializes a report. Redaction count is folded into stats.
 * The report's own `commit` hash is metadata, not a scanned value, so it is kept out
 * of the redaction walk (a 40-hex SHA otherwise matches the generic hex-secret rule).
 * Calls are validated one by one: a call that does not fit the schema is dropped (and
 * reported through `onWarning`) so the rest of the report is still written.
 */
export function toJson(report: Report, pretty = true, onWarning?: (message: string) => void): string {
  const { commit, ...rest } = report;
  const { value, count } = redact(rest);
  value.stats.redacted = count;
  const calls = validCalls(value.calls, onWarning);
  if (calls.length !== value.calls.length) value.stats.callsFound = calls.length;
  const parsed = ReportSchema.parse({ ...value, calls, commit });
  return JSON.stringify(parsed, null, pretty ? 2 : undefined);
}
