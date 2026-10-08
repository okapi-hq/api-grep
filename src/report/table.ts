import Table from "cli-table3";
import pc from "picocolors";
import { coverageWarnings, diagnosticsLine } from "./diagnostics.js";
import type { Call, Report } from "./schema.js";

const HEAD = ["line", "method", "provider", "path", "body", "dyn", "conf"];

function shortShape(c: Call): string {
  const b = c.body as { type?: string; properties?: Record<string, unknown>; fromType?: string } | undefined;
  if (!b) return "-";
  if (b.type === "object" && b.properties) {
    const keys = Object.keys(b.properties);
    const head = keys.slice(0, 5).join(", ") + (keys.length > 5 ? `, +${keys.length - 5}` : "");
    return `{${head}}${b.fromType ? pc.dim(` ${b.fromType}`) : ""}`;
  }
  return b.type ?? "?";
}

function conf(n: number): string {
  const s = n.toFixed(2);
  return n >= 0.7 ? pc.green(s) : n >= 0.4 ? pc.yellow(s) : pc.red(s);
}

function counts(byKey: Record<string, number>, max: number): string {
  return Object.entries(byKey)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}

/** One section per file (`src/billing.ts  typescript`), then one row per call in it. */
export function toTable(report: Report, minConfidence: number): string {
  const rows = report.calls.filter((c) => c.confidence >= minConfidence);
  const table = new Table({
    head: HEAD.map((h) => pc.bold(h)),
    wordWrap: true,
    colWidths: [6, 8, 18, 42, 36, 5, 6],
    style: { head: [], border: [] },
  });
  let file: string | undefined;
  for (const c of rows) {
    if (c.location.file !== file) {
      file = c.location.file;
      table.push([{ colSpan: HEAD.length, content: `${pc.bold(file)}  ${pc.dim(c.location.language)}` }]);
    }
    const provider = c.client === "sdk" ? `${c.provider} ${pc.dim("sdk")}` : c.framework ? `${c.provider} ${pc.dim(c.framework)}` : c.provider;
    table.push([pc.dim(String(c.location.line)), c.method, provider, c.pathTemplate + (c.via ? pc.dim(` (${c.via})`) : ""), shortShape(c), String(c.dynamic.length), conf(c.confidence)]);
  }
  const s = report.stats;
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
  const summary = `${plural(s.callsFound, "call")} in ${plural(s.filesScanned, "file")} (${rows.length} shown at confidence >= ${minConfidence}); languages: ${counts(s.byLanguage, 4)}; providers: ${counts(s.byProvider, 8)}`;
  const d = report.diagnostics;
  const coverage = d ? `\n${d.complete ? pc.dim(diagnosticsLine(d)) : pc.yellow(diagnosticsLine(d))}` : "";
  const sdkWarnings = report.coverage ? coverageWarnings(report.coverage).map((w) => `\n${pc.yellow(`⚠ ${w}`)}`).join("") : "";
  return `${table.toString()}\n${pc.dim(summary)}${coverage}${sdkWarnings}\n`;
}
