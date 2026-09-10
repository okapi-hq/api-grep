import { writeFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
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
}

function collect(value: string, prev: string[] = []): string[] {
  return [...prev, value];
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
    repo: path.basename(path.resolve(dir)),
  });
  const json = toJson(report);
  if (flags.out) writeFileSync(flags.out, json);
  if (flags.json) process.stdout.write(`${json}\n`);
  else if (!flags.out || !flags.json) {
    const min = flags.minConfidence !== undefined ? Number(flags.minConfidence) : 0.3;
    process.stdout.write(toTable(JSON.parse(json), min));
  }
}

export function buildProgram(): Command {
  const program = new Command().name("apicalls").description("Outbound API call extractor for TypeScript").version(pkg.version);
  program
    .command("scan")
    .argument("<dir>", "repository or package directory")
    .option("--json", "emit Report JSON to stdout (table otherwise)")
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

const isMain = process.argv[1] && /(?:^|[\\/])(?:cli\.(?:ts|js|mjs)|apicalls)$/.test(process.argv[1]);
if (isMain) {
  buildProgram()
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
