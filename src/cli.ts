import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { LANGUAGE_IDS } from "./lang/index.js";
import { PROVIDERS } from "./normalize/provider.js";
import { toCurl } from "./report/curl.js";
import { finalizeReport, serializeReport } from "./report/json.js";
import { reportJsonSchema } from "./report/json-schema.js";
import { printable } from "./report/printable.js";
import type { Language } from "./report/schema.js";
import { toTable } from "./report/table.js";
import { scan } from "./scan.js";
import { serve } from "./server/index.js";
import { unpackCommand } from "./server/unpack.js";
import { toolVersion } from "./version.js";

interface ScanFlags {
  language?: string[];
  json?: boolean;
  out?: string;
  tsconfig?: string;
  changedSince?: string;
  specs?: string;
  validate?: boolean;
  minConfidence: number;
  include?: string[];
  exclude?: string[];
  wrappers?: boolean;
  curl?: boolean;
  examples?: number;
}

function collect(value: string, prev: string[] = []): string[] {
  return [...prev, value];
}

/** `--language python,typescript` and repeated `--language` flags. */
function languages(values: string[] | undefined): Language[] | undefined {
  const ids = values?.flatMap((v) => v.split(",")).map((v) => v.trim().toLowerCase()).filter(Boolean);
  return ids && ids.length > 0 ? (ids as Language[]) : undefined;
}

function count(value: string): number {
  const n = Number(value);
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(n)) throw new InvalidArgumentError("expected a whole number (0 or more).");
  return n;
}

function port(value: string): number {
  const n = count(value);
  if (n > 65535) throw new InvalidArgumentError("expected a port from 0 to 65535.");
  return n;
}

function confidence(value: string): number {
  const n = Number(value);
  if (value.trim() === "" || !(n >= 0 && n <= 1)) throw new InvalidArgumentError("expected a number between 0 and 1.");
  return n;
}

/** Messages name files and expressions of the scanned repository: printed on one line, without control characters. */
function warn(message: string): void {
  process.stderr.write(`warning: ${printable(message)}\n`);
}

async function runScan(dir: string, flags: ScanFlags): Promise<void> {
  if (flags.validate && !flags.specs) throw new Error("--validate requires --specs <dir>");
  const scanned = await scan({
    dir,
    languages: languages(flags.language),
    tsconfig: flags.tsconfig,
    include: flags.include,
    exclude: flags.exclude,
    changedSince: flags.changedSince,
    specs: flags.specs,
    validate: flags.validate,
    wrappers: flags.wrappers,
    examples: flags.examples,
    repo: path.basename(path.resolve(dir)),
    onWarning: warn,
  });
  const report = finalizeReport(scanned, warn);
  if (flags.out) writeFileSync(flags.out, serializeReport(report));
  if (flags.json) process.stdout.write(`${serializeReport(report)}\n`);
  else if (flags.curl) process.stdout.write(toCurl(report, flags.minConfidence));
  else process.stdout.write(toTable(report, flags.minConfidence));
  // 0: complete scan, 2: partial scan (the report is still written), 1: fatal error (see the catch below)
  process.exitCode = report.diagnostics?.complete === false ? 2 : 0;
}

export function buildProgram(): Command {
  const program = new Command().name("api-grep").description(`Outbound API call extractor for ${LANGUAGE_IDS.join(", ")} code`).version(toolVersion());
  program
    .command("scan")
    .argument("<dir>", "repository or package directory")
    .option("--language <ids>", `languages to scan, comma-separated or repeated (default: all of ${LANGUAGE_IDS.join(", ")})`, collect)
    .option("--json", "emit Report JSON to stdout (table otherwise)")
    .option("--curl", "print example requests as curl commands (one per example)")
    .option("--examples <n>", "maximum example requests per call (default 3, 0 disables)", count)
    .option("--out <file>", "write JSON report to file")
    .option("--tsconfig <path>", "TypeScript: tsconfig.json to load (default: nearest)")
    .option("--changed-since <ref>", "only files changed vs git ref (+ importers, one hop)")
    .option("--specs <dir>", "directory with <provider>.{json,yaml} specs or an APIs-guru checkout")
    .option("--validate", "run deterministic checks against specs (requires --specs)")
    .option("--min-confidence <n>", "hide calls below this confidence in table and curl output (0 to 1)", confidence, 0.3)
    .option("--include <glob>", "include glob (repeatable)", collect)
    .option("--exclude <glob>", "exclude glob (repeatable)", collect)
    .option("--no-wrappers", "disable one-hop wrapper expansion")
    .action(runScan);
  program
    .command("schema")
    .description("print the JSON Schema of the --json report")
    .action(() => {
      process.stdout.write(`${JSON.stringify(reportJsonSchema(), null, 2)}\n`);
    });
  program
    .command("providers")
    .description("print the provider table (id, name, hosts, packages by ecosystem) as JSON")
    .action(() => {
      process.stdout.write(`${JSON.stringify(PROVIDERS, null, 2)}\n`);
    });
  program
    .command("serve")
    .description("scan archives over HTTP: POST a .tar.gz to /v1/scan and get the JSON report (see the README)")
    .option("--host <address>", "address to listen on (default: API_GREP_HOST or 127.0.0.1)")
    .option("--port <n>", "port to listen on, 0 for any free one (default: API_GREP_PORT, PORT or 8080)", port)
    .action((flags: { host?: string; port?: number }) => serve(flags, process.argv[1]!));
  // the server's own step: stdin to a directory, the archive checked as `serve` describes
  program.command("unpack", { hidden: true }).argument("<dir>").action(unpackCommand);
  return program;
}

/**
 * Large monorepos need several GB of heap (ts-morph keeps every source file and type alive), more than node's
 * default or a global NODE_OPTIONS cap usually allows. Re-run once with `--max-old-space-size=<API_GREP_HEAP_MB>`
 * (default 8192; set it to 0 to opt out) unless the flag is already on the command line. Only `scan` needs it:
 * `serve` runs each scan in its own process with that heap.
 */
function respawnWithHeap(): boolean {
  if (process.argv.slice(2).find((a) => !a.startsWith("-")) !== "scan") return false;
  const heapMb = Number(process.env.API_GREP_HEAP_MB ?? 8192);
  if (process.env.API_GREP_NO_RESPAWN || !(heapMb > 0) || process.execArgv.some((a) => a.includes("max-old-space-size"))) return false;
  const r = spawnSync(process.execPath, [`--max-old-space-size=${heapMb}`, ...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, API_GREP_NO_RESPAWN: "1" },
  });
  if (r.error) process.stderr.write(`cannot restart with a larger heap: ${r.error.message}\n`);
  process.exitCode = r.status ?? 1;
  return true;
}

const isMain = process.argv[1] && /(?:^|[\\/])(?:cli\.(?:ts|js|mjs)|api-grep)$/.test(process.argv[1]);
if (isMain && !respawnWithHeap()) {
  // a child of `serve` ends at its deadline by itself, even if the server could not kill it
  const deadline = Number(process.env.API_GREP_DEADLINE_MS);
  if (deadline > 0) setTimeout(() => process.exit(124), deadline).unref();
  buildProgram()
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      process.stderr.write(`${printable(err instanceof Error ? err.message : String(err))}\n`);
      process.exitCode = 1;
    });
}
