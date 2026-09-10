import type { Call, Example, Report } from "./schema.js";

function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function bodyFlags(ex: Example): string[] {
  if (ex.body === undefined || ex.bodyEncoding === "none") return [];
  if (ex.bodyEncoding === "json") return [`--data ${sq(JSON.stringify(ex.body))}`];
  if (ex.bodyEncoding === "raw") return [`--data-binary ${sq(typeof ex.body === "string" ? ex.body : JSON.stringify(ex.body))}`];
  const flag = ex.bodyEncoding === "form" ? "--data-urlencode" : "-F";
  const obj = ex.body && typeof ex.body === "object" && !Array.isArray(ex.body) ? (ex.body as Record<string, unknown>) : { body: ex.body };
  return Object.entries(obj).map(([k, v]) => `${flag} ${sq(`${k}=${typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}`)}`);
}

/** One curl command per example; arguments are single-quoted for a POSIX shell. */
export function exampleToCurl(ex: Example): string {
  const parts = [`curl -X ${ex.method} ${sq(ex.url)}`];
  for (const [k, v] of Object.entries(ex.headers)) parts.push(`-H ${sq(`${k}: ${v}`)}`);
  parts.push(...bodyFlags(ex));
  return parts.join(" \\\n  ");
}

function header(c: Call): string {
  const via = c.via ? ` via ${c.via}` : "";
  return `# ${c.location.file}:${c.location.line}  ${c.provider} ${c.method} ${c.pathTemplate}${via}  (confidence ${c.confidence.toFixed(2)})`;
}

/** Renders every example of every call above `minConfidence` as commented curl commands. */
export function toCurl(report: Report, minConfidence: number): string {
  const blocks: string[] = [];
  for (const c of report.calls) {
    if (c.confidence < minConfidence) continue;
    const lines = [header(c)];
    for (const ex of c.examples) lines.push(`# ${ex.variant}`, exampleToCurl(ex));
    blocks.push(lines.join("\n"));
  }
  return `${blocks.join("\n\n")}\n`;
}
