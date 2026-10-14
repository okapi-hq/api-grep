import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toJson } from "../../src/report/json.js";
import { ReportSchema, type Report } from "../../src/report/schema.js";
import { scan } from "../../src/scan.js";
import { parseJson, readBounded } from "./read.js";
import type { RepoSpec } from "./repos.js";

/** A repository's scan: its report, or why there is none (the scan stopped). */
export interface ScanOutcome {
  repo: RepoSpec;
  report?: Report;
  /** First line of the error or the exit status; printed only with `--detail`. */
  error?: string;
}

export type Scanner = (repo: RepoSpec) => Promise<ScanOutcome>;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
/** A report of a very large repository is tens of megabytes; past this it would not parse under a 2 GB heap anyway. */
const MAX_REPORT_BYTES = 512 * 1024 * 1024;

function firstLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0]!;
}

/** A report file read back and checked against the report schema; an outcome without a report when it is not one. */
export function loadReport(repo: RepoSpec, file: string): ScanOutcome {
  try {
    const parsed = ReportSchema.safeParse(parseJson(readBounded(file, MAX_REPORT_BYTES), "the report"));
    return parsed.success ? { repo, report: parsed.data } : { repo, error: "the report does not fit the report schema" };
  } catch (err) {
    return { repo, error: firstLine(err) };
  }
}

/** Reports written earlier (`<dir>/<name>.json`): a missing one counts as a scan that stopped. */
export function reportsFrom(dir: string): Scanner {
  return (repo) => Promise.resolve(existsSync(path.join(dir, `${repo.name}.json`)) ? loadReport(repo, path.join(dir, `${repo.name}.json`)) : { repo, error: "no report" });
}

/**
 * Runs `api-grep scan` from source in a child process with a 2 GB heap, like a user would: a crash or an out-of-memory
 * stops that scan only. Exit 0 is a complete scan, 2 a partial one (the report is written), anything else a stop.
 */
export function cliScanner(outDir: string | undefined, timeoutMs: number): Scanner {
  return (repo) => {
    if (!existsSync(repo.dir)) return Promise.resolve({ repo, error: "directory not found" });
    const dir = outDir ?? mkdtempSync(path.join(os.tmpdir(), "api-grep-inventory-"));
    mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${repo.name}.json`);
    rmSync(out, { force: true });
    const args = ["--max-old-space-size=2048", "--import", "tsx", path.join(ROOT, "src", "cli.ts"), "scan", repo.dir, "--out", out, "--examples", "0"];
    if (repo.language) args.push("--language", repo.language);
    const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"], timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
    try {
      if (r.status === 0 || r.status === 2) return Promise.resolve(loadReport(repo, out));
      const why = r.error ? firstLine(r.error) : r.signal ? `killed by ${r.signal}` : `exit ${r.status}`;
      const stderr = r.stderr?.toString("utf8").trim().split("\n").pop() ?? "";
      return Promise.resolve({ repo, error: stderr ? `${why}: ${stderr}` : why });
    } finally {
      if (!outDir) rmSync(dir, { recursive: true, force: true });
    }
  };
}

/** Runs `scan()` in this process, like `eval/run.ts`: faster, but an out-of-memory stops the whole run. */
export function inProcessScanner(outDir?: string): Scanner {
  return async (repo) => {
    try {
      if (!existsSync(repo.dir)) return { repo, error: "directory not found" };
      const scanned = await scan({ dir: repo.dir, repo: repo.name, examples: 0, ...(repo.language ? { languages: [repo.language] } : {}) });
      const json = toJson(scanned);
      if (outDir) {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(path.join(outDir, `${repo.name}.json`), json);
      }
      return { repo, report: ReportSchema.parse(JSON.parse(json)) };
    } catch (err) {
      return { repo, error: firstLine(err) };
    }
  };
}

/** Scans one repository after the other: at most one heavy scan at a time. */
export async function collect(repos: RepoSpec[], scanner: Scanner, onProgress?: (done: number, total: number) => void): Promise<ScanOutcome[]> {
  const out: ScanOutcome[] = [];
  for (const repo of repos) {
    out.push(await scanner(repo));
    onProgress?.(out.length, repos.length);
  }
  return out;
}
