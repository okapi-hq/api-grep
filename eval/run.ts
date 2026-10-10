import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toJson } from "../src/report/json.js";
import type { Language, Report } from "../src/report/schema.js";
import { scan } from "../src/scan.js";

interface RepoSpec {
  name: string;
  url: string;
  subdir?: string;
  /** Scan this language only (a Python or PHP repository also ships JavaScript). */
  language?: Language;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const reposDir = path.join(here, "repos");
const outDir = path.join(here, "out");

function clone(repo: RepoSpec): string {
  const dir = path.join(reposDir, repo.name);
  if (!existsSync(dir)) {
    process.stderr.write(`cloning ${repo.url}\n`);
    if (!/^https:\/\//.test(repo.url) || path.basename(repo.name) !== repo.name) throw new Error(`refusing repo entry ${repo.name}: ${repo.url}`);
    execFileSync("git", ["clone", "--depth", "1", "--quiet", "--", repo.url, dir], { stdio: "inherit" });
  }
  return dir;
}

interface Row {
  repo: string;
  subdir: string;
  files: number;
  calls: number;
  hi: number;
  sdk: number;
  body: number;
  dyn: number;
  seconds: number;
  providers: string;
  /** `complete`, or what made the scan partial (`2 skipped, 5 not followed`). */
  coverage: string;
  /** Calls whose provider stays `unknown` or `env:*` (`internal` is a resolved answer: the repo's own backend). */
  unresolved: number;
  error?: string;
}

function summarize(repo: RepoSpec, r: Report): Row {
  const s = r.stats;
  const providers = Object.entries(s.byProvider)
    .slice(0, 8)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return {
    repo: repo.name,
    subdir: repo.subdir ?? ".",
    files: s.filesScanned,
    calls: s.callsFound,
    hi: r.calls.filter((c) => c.confidence >= 0.7).length,
    sdk: s.byClient.sdk ?? 0,
    body: s.withBodyShape,
    dyn: s.withDynamic,
    seconds: Math.round(s.durationMs / 100) / 10,
    providers,
    coverage: coverageOf(r),
    unresolved: r.calls.filter((c) => c.provider === "unknown" || c.provider.startsWith("env:")).length,
  };
}

function coverageOf(r: Report): string {
  const d = r.diagnostics;
  if (!d) return "?";
  if (d.complete) return "complete";
  const lost = d.skipped.filter((s) => s.reason === "parse-error" || s.reason === "internal-error").length;
  return [lost && `${lost} skipped`, d.droppedCalls.length && `${d.droppedCalls.length} dropped`, d.unfollowed.length && `${d.unfollowed.length} not followed`].filter(Boolean).join(", ");
}

function line(row: Row): string {
  if (row.error) return `${row.repo.padEnd(13)} ERROR ${row.error}`;
  return `${row.repo.padEnd(13)} files=${String(row.files).padStart(5)} calls=${String(row.calls).padStart(5)} hi=${String(row.hi).padStart(4)} sdk=${String(row.sdk).padStart(4)} body=${String(row.body).padStart(4)} dyn=${String(row.dyn).padStart(4)} unresolved=${String(row.unresolved).padStart(4)} ${String(row.seconds).padStart(6)}s | ${row.coverage} | ${row.providers}`;
}

function markdown(rows: Row[], commits: Map<string, string | undefined>): string {
  const head = "| repo | scanned dir | files | calls | conf ≥ 0.7 | sdk | with body | with dynamic | unresolved provider | time | coverage | top providers |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|";
  const body = rows.map((r) =>
    r.error
      ? `| ${r.repo} | ${r.subdir} | error | | | | | | | | | ${r.error.replace(/\|/g, "/")} |`
      : `| ${r.repo} | ${r.subdir} | ${r.files} | ${r.calls} | ${r.hi} | ${r.sdk} | ${r.body} | ${r.dyn} | ${r.unresolved} | ${r.seconds}s | ${r.coverage} | ${r.providers.replace(/\|/g, "/")} |`,
  );
  const ok = rows.filter((r) => !r.error);
  const total = (k: keyof Row): number => ok.reduce((a, r) => a + Number(r[k]), 0);
  const commitList = rows.map((r) => `- ${r.repo}: ${commits.get(r.repo) ?? "?"}`).join("\n");
  return [
    `# api-grep eval run — ${new Date().toISOString().slice(0, 10)}`,
    "",
    `Shallow clones, no \`node_modules\` installed in the targets (types of third-party packages are therefore unresolved; SDK detection relies on imports). Per-repo JSON reports are in \`eval/out/<repo>.json\`.`,
    "",
    head,
    ...body,
    "",
    `**Totals over ${ok.length} repos:** ${total("files")} files scanned, ${total("calls")} calls found, ${total("hi")} at confidence ≥ 0.7, ${total("sdk")} via SDK registries, ${total("body")} with a body shape, ${total("dyn")} with at least one dynamic part, ${Math.round(total("seconds"))}s total scan time.`,
    "",
    "## Commits scanned",
    "",
    commitList,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const only = process.argv.slice(2);
  const repos = (JSON.parse(readFileSync(path.join(here, "repos.json"), "utf8")) as RepoSpec[]).filter((r) => only.length === 0 || only.includes(r.name));
  mkdirSync(outDir, { recursive: true });
  const rows: Row[] = [];
  const commits = new Map<string, string | undefined>();
  for (const repo of repos) {
    const row = await runOne(repo, commits);
    rows.push(row);
    process.stdout.write(`${line(row)}\n`);
  }
  writeFileSync(path.join(outDir, "summary.txt"), `${rows.map(line).join("\n")}\n`);
  const resultsFile = process.env.API_GREP_RESULTS ?? path.join(here, "results.md");
  writeFileSync(resultsFile, markdown(rows, commits));
  process.stdout.write(`wrote ${path.relative(process.cwd(), resultsFile)}\n`);
}

async function runOne(repo: RepoSpec, commits: Map<string, string | undefined>): Promise<Row> {
  try {
    const root = clone(repo);
    const dir = repo.subdir ? path.join(root, repo.subdir) : root;
    if (!existsSync(dir)) throw new Error(`subdir not found: ${repo.subdir}`);
    const specs = process.env.API_GREP_SPECS;
    const report = await scan({ dir, repo: repo.name, specs, validate: !!specs, ...(repo.language ? { languages: [repo.language] } : {}) });
    commits.set(repo.name, report.commit);
    writeFileSync(path.join(outDir, `${repo.name}.json`), toJson(report));
    return summarize(repo, report);
  } catch (err) {
    const message = err instanceof Error ? err.message.split("\n")[0]! : String(err);
    return { repo: repo.name, subdir: repo.subdir ?? ".", files: 0, calls: 0, hi: 0, sdk: 0, body: 0, dyn: 0, seconds: 0, providers: "", coverage: "", unresolved: 0, error: message };
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exitCode = 1;
});
