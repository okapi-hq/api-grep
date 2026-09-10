import Table from "cli-table3";
import pc from "picocolors";
import type { Call, Report } from "./schema.js";

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

export function toTable(report: Report, minConfidence: number): string {
  const rows = report.calls.filter((c) => c.confidence >= minConfidence);
  const table = new Table({
    head: ["conf", "provider", "method", "path", "body", "dyn", "location"].map((h) => pc.bold(h)),
    wordWrap: true,
    colWidths: [6, 14, 8, 40, 36, 5, 40],
    style: { head: [], border: [] },
  });
  for (const c of rows) {
    const loc = `${c.location.file}:${c.location.line}`;
    const provider = c.client === "sdk" ? `${c.provider} ${pc.dim("sdk")}` : c.framework ? `${c.provider} ${pc.dim(c.framework)}` : c.provider;
    table.push([conf(c.confidence), provider, c.method, c.pathTemplate + (c.via ? pc.dim(` (${c.via})`) : ""), shortShape(c), String(c.dynamic.length), pc.dim(loc)]);
  }
  const s = report.stats;
  const summary = `${s.callsFound} calls in ${s.filesScanned} files (${rows.length} shown at confidence >= ${minConfidence}); providers: ${Object.entries(s.byProvider)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ")}`;
  return `${table.toString()}\n${pc.dim(summary)}\n`;
}
