import { spawn, spawnSync, type SpawnSyncOptions } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import type { Report } from "../../src/report/schema.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The build by default; `API_GREP_E2E_CLI=/path/to/cli.js` runs the suite against another build (an installed package). */
export const CLI = process.env.API_GREP_E2E_CLI ?? path.join(ROOT, "dist", "cli.js");
export const FIXTURES = path.join(ROOT, "tests", "fixtures");

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the built CLI. The heap respawn is kept off unless a test asks for it (`env: { API_GREP_NO_RESPAWN: "" }`). */
export function cli(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Run {
  const spawnOpts: SpawnSyncOptions = {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, API_GREP_NO_RESPAWN: "1", NO_COLOR: "1", ...opts.env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 110_000,
  };
  const r = spawnSync(process.execPath, [CLI, ...args], spawnOpts);
  return { status: r.status, stdout: String(r.stdout), stderr: String(r.stderr) };
}

/** `cli` without blocking the event loop, for tests that serve requests while the CLI runs. */
export function cliAsync(args: string[]): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...process.env, API_GREP_NO_RESPAWN: "1" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

export function scanJson(dir: string, args: string[] = []): { run: Run; report: Report } {
  const run = cli(["scan", dir, "--json", ...args]);
  if (run.status === 1) throw new Error(`scan failed: ${run.stderr}`);
  return { run, report: JSON.parse(run.stdout) as Report };
}

const committedSchema = JSON.parse(readFileSync(path.join(ROOT, "schema", "report.v1.json"), "utf8")) as Record<string, unknown>;
const validateReport = new Ajv({ allErrors: true, allowUnionTypes: true }).compile(committedSchema);

/** Schema errors of a report against the committed JSON Schema (empty when valid). */
export function schemaErrors(report: unknown): unknown[] {
  return validateReport(report) ? [] : (validateReport.errors ?? []);
}

/** A throwaway repository: `files` maps relative paths to contents. Removed by `removeTempDirs`. */
const made: string[] = [];
export function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "api-grep-e2e-"));
  made.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function git(dir: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "user.name=e2e", "-c", "user.email=e2e@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}
