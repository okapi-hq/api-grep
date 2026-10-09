import { printable } from "../report/printable.js";
import { cliArgv, runChild } from "./child.js";
import { HttpError } from "./errors.js";

export interface RunOptions {
  timeoutMs: number;
  maxReportBytes: number;
  /** `--max-old-space-size` of the scan process; 0 leaves node's default. */
  heapMb: number;
  /** The request's temporary root: git never looks above it, and it never appears in an error message. */
  root: string;
  /** Aborted when the client goes away or the server stops: the scan is stopped. */
  signal?: AbortSignal;
}

/** Why the scan process failed: paths inside the archive are kept, the server's own directories are not. */
function scanFailure(stderr: string, dir: string, root: string): HttpError {
  if (/heap out of memory|Reached heap limit/i.test(stderr)) {
    return new HttpError(500, "scan_out_of_memory", "the scan ran out of memory: raise API_GREP_HEAP_MB or the server's memory");
  }
  const first = (stderr.split("\n").find((l) => l.trim()) ?? "").trim().split(dir).join("<archive>").split(root).join("<tmp>");
  const detail = printable(first).slice(0, 300);
  return new HttpError(500, "scan_failed", detail ? `the scan failed: ${detail}` : "the scan failed");
}

/**
 * Runs `<cli> scan <dir> --json <args>` in its own process group (`runChild`) and resolves with the JSON report it
 * prints: exit code 0, or 2 for a partial scan.
 */
export async function runScan(cli: string, dir: string, args: string[], opts: RunOptions): Promise<string> {
  const result = await runChild(cliArgv(cli, ["scan", dir, "--json", ...args], opts.heapMb), {
    root: opts.root,
    timeoutMs: opts.timeoutMs,
    maxStdoutBytes: opts.maxReportBytes,
    signal: opts.signal,
    timeout: () => new HttpError(504, "scan_timeout", `the scan took more than ${opts.timeoutMs / 1000}s`),
  });
  if (result.code === 0 || result.code === 2) return result.stdout;
  throw scanFailure(result.stderr, dir, opts.root);
}
