import { Command, InvalidArgumentError } from "commander";
import { runInventory } from "./inventory/run.js";

/**
 * The private evaluation of #114 in one command: scans every repository under `--repos`, matches the calls with a
 * reference inventory of call sites and prints the totals of the four checks (#3, #4, #7, #8). Usage and the inventory
 * format: eval/README.md.
 */

function whole(value: string): number {
  const n = Number(value);
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(n)) throw new InvalidArgumentError("expected a whole number (0 or more).");
  return n;
}

const program = new Command("eval:inventory")
  .requiredOption("--repos <dir>", "one subdirectory per repository")
  .requiredOption("--inventory <file>", "reference inventory, CSV or JSON (repo,file,line[,service,kind,target])")
  .option("--manifest <file>", "repositories to run, shaped like eval/repos.json (name, subdir, language); default: every subdirectory of --repos")
  .option("--reports <dir>", "read <dir>/<repo>.json reports instead of scanning")
  .option("--out <dir>", "keep the report of each scan in <dir>/<repo>.json")
  .option("--tolerance <n>", "lines between an inventory entry and a reported call", whole, 3)
  .option("--timeout <minutes>", "per scan", whole, 30)
  .option("--in-process", "scan in this process (faster; an out-of-memory then stops the whole run)")
  .option("--json", "print the totals as JSON")
  .option("--detail", "add a line per repository and the missed call sites (names and paths: never post them)")
  .action(async (flags: { repos: string; inventory: string; manifest?: string; reports?: string; out?: string; tolerance: number; timeout: number; inProcess?: boolean; json?: boolean; detail?: boolean }) => {
    if (flags.detail) process.stderr.write("warning: --detail prints repository names and paths: keep them local, post the totals only\n");
    const { output } = await runInventory({ ...flags, timeoutMs: flags.timeout * 60_000 }, undefined, (done, total) => process.stderr.write(`scanned ${done}/${total}\n`));
    process.stdout.write(output);
  });

program.parseAsync().catch((err: unknown) => {
  // the message can name a local path, never the inventory's content
  process.stderr.write(`eval:inventory: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}\n`);
  process.exitCode = 1;
});
