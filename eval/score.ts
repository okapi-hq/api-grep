import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Call, Report } from "../src/report/schema.js";

/**
 * Labeling protocol:
 *   pnpm eval:score sample <repo> [n]   -> writes eval/label/<repo>.csv with n calls stratified by confidence bucket
 *   pnpm eval:score                     -> scores every eval/label/*.csv against eval/out/<repo>.json
 *
 * CSV columns: id,file,line,provider,method,path,confidence,is_call,provider_ok,path_ok,body_ok,notes
 *   is_call / provider_ok / path_ok: y | n
 *   body_ok: y | partial | n | na
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out");
const labelDir = path.join(here, "label");

function bucket(c: number): string {
  return c >= 0.7 ? "high" : c >= 0.4 ? "mid" : "low";
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function sample(repo: string, n: number): void {
  const report = JSON.parse(readFileSync(path.join(outDir, `${repo}.json`), "utf8")) as Report;
  const groups = new Map<string, Call[]>();
  for (const c of report.calls) groups.set(bucket(c.confidence), [...(groups.get(bucket(c.confidence)) ?? []), c]);
  const per = Math.ceil(n / Math.max(1, groups.size));
  const picked: Call[] = [];
  let seed = 42;
  const rand = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (const calls of groups.values()) {
    const shuffled = [...calls].sort(() => rand() - 0.5);
    picked.push(...shuffled.slice(0, per));
  }
  const rows = picked.slice(0, n).map((c) => [c.id, c.location.file, String(c.location.line), c.provider, c.method, c.pathTemplate, String(c.confidence), "", "", "", "", ""].map(csvEscape).join(","));
  const header = "id,file,line,provider,method,path,confidence,is_call,provider_ok,path_ok,body_ok,notes";
  writeFileSync(path.join(labelDir, `${repo}.csv`), `${header}\n${rows.join("\n")}\n`);
  process.stdout.write(`wrote ${rows.length} rows to eval/label/${repo}.csv\n`);
}

function parseCsv(text: string): Record<string, string>[] {
  const [head, ...lines] = text.trim().split("\n");
  const cols = head!.split(",");
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (q && ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = !q;
      else if (ch === "," && !q) {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
  });
}

function pct(num: number, den: number): string {
  return den === 0 ? "n/a" : `${((100 * num) / den).toFixed(1)}% (${num}/${den})`;
}

function score(repo: string): void {
  const rows = parseCsv(readFileSync(path.join(labelDir, `${repo}.csv`), "utf8")).filter((r) => r.is_call);
  const real = rows.filter((r) => r.is_call === "y");
  const byBucket = new Map<string, { real: number; total: number }>();
  for (const r of rows) {
    const b = bucket(Number(r.confidence));
    const e = byBucket.get(b) ?? { real: 0, total: 0 };
    e.total++;
    if (r.is_call === "y") e.real++;
    byBucket.set(b, e);
  }
  process.stdout.write(`\n${repo}: labeled ${rows.length}\n`);
  process.stdout.write(`  precision (is a real outbound call): ${pct(real.length, rows.length)}\n`);
  for (const [b, e] of byBucket) process.stdout.write(`    ${b}: ${pct(e.real, e.total)}\n`);
  process.stdout.write(`  provider correct: ${pct(real.filter((r) => r.provider_ok === "y").length, real.length)}\n`);
  process.stdout.write(`  path correct:     ${pct(real.filter((r) => r.path_ok === "y").length, real.length)}\n`);
  const withBody = real.filter((r) => r.body_ok && r.body_ok !== "na");
  process.stdout.write(`  body correct:     ${pct(withBody.filter((r) => r.body_ok === "y").length, withBody.length)} partial: ${withBody.filter((r) => r.body_ok === "partial").length}\n`);
  const missedFile = path.join(labelDir, `${repo}.missed.txt`);
  if (existsSync(missedFile)) {
    const missed = readFileSync(missedFile, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).length;
    process.stdout.write(`  recall (grep pass): ${pct(real.length, real.length + missed)} with ${missed} hand-found misses\n`);
  }
}

const [cmd, repo, n] = process.argv.slice(2);
if (cmd === "sample" && repo) sample(repo, Number(n ?? 100));
else {
  const files = existsSync(labelDir) ? (await import("node:fs")).readdirSync(labelDir).filter((f) => f.endsWith(".csv")) : [];
  if (files.length === 0) process.stdout.write("no labels yet: run `pnpm eval:score sample <repo> 100` and fill the CSV\n");
  for (const f of files) score(f.replace(/\.csv$/, ""));
}
