import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { toCurl } from "./report/curl.js";
import { toJson } from "./report/json.js";
import { toTable } from "./report/table.js";
import { scan } from "./scan.js";
import pkg from "../package.json" with { type: "json" };

interface ScanFlags {
  json?: boolean;
  out?: string;
  tsconfig?: string;
  changedSince?: string;
  specs?: string;
  validate?: boolean;
  minConfidence?: string;
  include?: string[];
  exclude?: string[];
  wrappers?: boolean;
  curl?: boolean;
  examples?: string;
}

function collect(value: string, prev: string[] = []): string[] {
  return [...prev, value];
}

function warn(message: string): void {
  process.stderr.write(`warning: ${message}\n`);
}

async function runScan(dir: string, flags: ScanFlags): Promise<void> {
  if (flags.validate && !flags.specs) throw new Error("--validate requires --specs <dir>");
  const report = await scan({
    dir,
    tsconfig: flags.tsconfig,
    include: flags.include,
    exclude: flags.exclude,
    changedSince: flags.changedSince,
    specs: flags.specs,
    validate: flags.validate,
    wrappers: flags.wrappers,
    examples: flags.examples !== undefined ? Number(flags.examples) : undefined,
    repo: path.basename(path.resolve(dir)),
    onWarning: warn,
  });
  const json = toJson(report, true, warn);
  if (flags.out) writeFileSync(flags.out, json);
  const min = flags.minConfidence !== undefined ? Number(flags.minConfidence) : 0.3;
  if (flags.json) process.stdout.write(`${json}\n`);
  else if (flags.curl) process.stdout.write(toCurl(JSON.parse(json), min));
  else process.stdout.write(toTable(JSON.parse(json), min));
}

export function buildProgram(): Command {
  const program = new Command().name("apicalls").description("Outbound API call extractor for TypeScript").version(pkg.version);
  program
    .command("scan")
    .argument("<dir>", "repository or package directory")
    .option("--json", "emit Report JSON to stdout (table otherwise)")
    .option("--curl", "print example requests as curl commands (one per example)")
    .option("--examples <n>", "maximum example requests per call (default 3, 0 disables)")
    .option("--out <file>", "write JSON report to file")
    .option("--tsconfig <path>", "tsconfig.json to load (default: nearest)")
    .option("--changed-since <ref>", "only files changed vs git ref (+ importers, one hop)")
    .option("--specs <dir>", "directory with <provider>.{json,yaml} specs or an APIs-guru checkout")
    .option("--validate", "run deterministic checks against specs (requires --specs)")
    .option("--min-confidence <n>", "hide calls below this confidence in table output (default 0.3)")
    .option("--include <glob>", "include glob (repeatable)", collect)
    .option("--exclude <glob>", "exclude glob (repeatable)", collect)
    .option("--no-wrappers", "disable one-hop wrapper expansion")
    .action(runScan);
  return program;
}

/**
 * Large monorepos need several GB of heap (ts-morph keeps every source file and type alive), more than node's
 * default or a global NODE_OPTIONS cap usually allows. Re-run once with `--max-old-space-size=<APICALLS_HEAP_MB>`
 * (default 8192; set it to 0 to opt out) unless the flag is already on the command line.
 */
function respawnWithHeap(): boolean {
  const heapMb = Number(process.env.APICALLS_HEAP_MB ?? 8192);
  if (process.env.APICALLS_NO_RESPAWN || !(heapMb > 0) || process.execArgv.some((a) => a.includes("max-old-space-size"))) return false;
  const r = spawnSync(process.execPath, [`--max-old-space-size=${heapMb}`, ...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, APICALLS_NO_RESPAWN: "1" },
  });
  process.exitCode = r.status ?? 1;
  return true;
}

const isMain = process.argv[1] && /(?:^|[\\/])(?:cli\.(?:ts|js|mjs)|apicalls)$/.test(process.argv[1]);
if (isMain && !respawnWithHeap()) {
  buildProgram()
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
