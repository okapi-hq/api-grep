import { redact } from "./redact.js";
import { type Report, ReportSchema } from "./schema.js";
import { splitValid } from "./valid.js";

/**
 * The report as written: redacted and validated. Redaction count is folded into stats.
 * The report's own `commit` hash is metadata, not a scanned value, so it is kept out
 * of the redaction walk (a 40-hex SHA otherwise matches the generic hex-secret rule).
 * Calls are validated one by one: a call that does not fit the schema is dropped, listed
 * in `diagnostics.droppedCalls` and reported through `onWarning`; the rest is still written.
 * Every output (JSON, table, curl) is rendered from this, so none of them can show what redaction removed.
 */
export function finalizeReport(report: Report, onWarning?: (message: string) => void): Report {
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
  return ReportSchema.parse({ ...value, calls: valid, commit });
}

/** Redacts, validates and serializes a report (see `finalizeReport`). */
export function toJson(report: Report, pretty = true, onWarning?: (message: string) => void): string {
  return serializeReport(finalizeReport(report, onWarning), pretty);
}

/** Serializes a report that already went through `finalizeReport`. */
export function serializeReport(report: Report, pretty = true): string {
  return JSON.stringify(report, null, pretty ? 2 : undefined);
}
