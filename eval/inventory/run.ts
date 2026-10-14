import { detailMarkdown, totalsMarkdown } from "./markdown.js";
import { readInventory } from "./read.js";
import { listRepos } from "./repos.js";
import { cliScanner, collect, inProcessScanner, reportsFrom, type Scanner } from "./reports.js";
import { computeTotals, type RepoDetail, type Totals } from "./totals.js";

export interface InventoryOptions {
  repos: string;
  inventory: string;
  manifest?: string;
  /** Read `<reports>/<name>.json` instead of scanning. */
  reports?: string;
  /** Keep the reports of this run in `<out>/<name>.json`. */
  out?: string;
  tolerance: number;
  json?: boolean;
  detail?: boolean;
  inProcess?: boolean;
  timeoutMs: number;
}

export interface InventoryResult {
  totals: Totals;
  details: RepoDetail[];
  /** What to print on stdout. */
  output: string;
}

function scannerFor(opts: InventoryOptions): Scanner {
  if (opts.reports) return reportsFrom(opts.reports);
  return opts.inProcess ? inProcessScanner(opts.out) : cliScanner(opts.out, opts.timeoutMs);
}

/** The four checks of #114: scan (or read the reports of) every repository, match the inventory, count. */
export async function runInventory(opts: InventoryOptions, scanner: Scanner = scannerFor(opts), onProgress?: (done: number, total: number) => void): Promise<InventoryResult> {
  const inventory = readInventory(opts.inventory);
  const repos = listRepos(opts.repos, opts.manifest);
  const outcomes = await collect(repos, scanner, onProgress);
  const { totals, details } = computeTotals(outcomes, inventory, opts.tolerance);
  const shown = opts.json ? `${JSON.stringify(opts.detail ? { totals, details } : { totals }, null, 2)}\n` : totalsMarkdown(totals);
  const output = opts.detail && !opts.json ? `${shown}\n${detailMarkdown(details)}` : shown;
  return { totals, details, output };
}
