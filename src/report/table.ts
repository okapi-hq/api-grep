import Table from "cli-table3";
import pc from "picocolors";
import { coverageWarnings, diagnosticsLine, hostsLine, plural } from "./diagnostics.js";
import { printable } from "./printable.js";
import type { Call, Report } from "./schema.js";

const HEAD = ["line", "method", "provider", "path", "body", "dyn"];

function shortShape(c: Call): string {
  const b = c.body;
  if (!b) return "-";
  if (b.type === "object") {
    const keys = Object.keys(b.properties);
    const head = keys.slice(0, 5).join(", ") + (keys.length > 5 ? `, +${keys.length - 5}` : "");
    return `{${printable(head)}}${b.fromType ? pc.dim(` ${printable(b.fromType)}`) : ""}`;
  }
  return b.type;
}

function counts(byKey: Record<string, number>, max: number): string {
  return Object.entries(byKey)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k, v]) => `${printable(k)}=${v}`)
    .join(", ");
}

/** One section per file (`src/billing.ts  typescript`), then one row per call in it. */
export function toTable(report: Report): string {
  const table = new Table({
    head: HEAD.map((h) => pc.bold(h)),
    wordWrap: true,
    colWidths: [6, 8, 18, 42, 36, 5],
    style: { head: [], border: [] },
  });
  let file: string | undefined;
  for (const c of report.calls) {
    if (c.location.file !== file) {
      file = c.location.file;
      table.push([{ colSpan: HEAD.length, content: `${pc.bold(printable(file))}  ${pc.dim(c.location.language)}` }]);
    }
    const name = printable(c.provider);
    const provider = c.client === "sdk" ? `${name} ${pc.dim("sdk")}` : c.framework ? `${name} ${pc.dim(printable(c.framework))}` : name;
    // calls to one URL that name their operation elsewhere (JSON-RPC) differ by it
    const operation = c.operation?.name ? ` ${printable(c.operation.name)}` : "";
    const target = printable(c.pathTemplate) + operation + (c.via ? pc.dim(` (${printable(c.via)})`) : "");
    table.push([pc.dim(String(c.location.line)), printable(c.method), provider, target, shortShape(c), String(c.dynamic.length)]);
  }
  const s = report.stats;
  const summary = `${plural(s.callsFound, "call", "calls")} in ${plural(s.filesScanned, "file", "files")}; languages: ${counts(s.byLanguage, 4)}; providers: ${counts(s.byProvider, 8)}`;
  const d = report.diagnostics;
  const coverage = d ? `\n${d.complete ? pc.dim(diagnosticsLine(d)) : pc.yellow(diagnosticsLine(d))}` : "";
  const hosts = report.coverage?.hosts ? `\n${pc.dim(printable(hostsLine(report.coverage.hosts)))}` : "";
  const sdkWarnings = report.coverage ? coverageWarnings(report.coverage).map((w) => `\n${pc.yellow(`⚠ ${w}`)}`).join("") : "";
  return `${table.toString()}\n${pc.dim(summary)}${coverage}${hosts}${sdkWarnings}\n`;
}
