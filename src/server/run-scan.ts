import { spawn } from "node:child_process";
import { printable } from "../report/printable.js";
import { HttpError } from "./errors.js";

export interface RunOptions {
  timeoutMs: number;
  maxReportBytes: number;
  /** `--max-old-space-size` of the scan process; 0 leaves node's default. */
  heapMb: number;
  /** The scan's temporary root: git never looks above it, and it never appears in an error message. */
  root: string;
  /** Aborted when the client goes away: the scan is stopped. */
  signal?: AbortSignal;
}

/** `node [--max-old-space-size=N] <cli> scan <dir> --json <args>`: the scan runs as it does from the command line. */
function scanArgv(cli: string, dir: string, args: string[], heapMb: number): string[] {
  const heap = heapMb > 0 ? [`--max-old-space-size=${heapMb}`] : [];
  const execArgv = process.execArgv.filter((a) => !a.includes("max-old-space-size"));
  return [...heap, ...execArgv, cli, "scan", dir, "--json", ...args];
}

/** The scan process gets none of the server's secrets: a few variables, no heap respawn, no colors. */
function scanEnv(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { API_GREP_NO_RESPAWN: "1", NO_COLOR: "1", GIT_CEILING_DIRECTORIES: root };
  for (const key of ["PATH", "TMPDIR", "LANG", "API_GREP_BUILD"]) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
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
 * Runs one scan in its own process group and resolves with the JSON report it prints (exit code 0, or 2 for a partial
 * scan). A timeout, an oversized report or an abort kills the whole group, so no scan outlives its request.
 */
export function runScan(cli: string, dir: string, args: string[], opts: RunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, scanArgv(cli, dir, args, opts.heapMb), { detached: true, stdio: ["ignore", "pipe", "pipe"], env: scanEnv(opts.root) });
    const out: Buffer[] = [];
    let outBytes = 0;
    let stderr = "";
    let failure: HttpError | undefined;
    const kill = (err: HttpError): void => {
      failure ??= err;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // already gone
      }
    };
    const timer = setTimeout(() => kill(new HttpError(504, "scan_timeout", `the scan took more than ${opts.timeoutMs / 1000}s`)), opts.timeoutMs);
    const onAbort = (): void => kill(new HttpError(499, "client_closed", "the client closed the connection"));
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const settle = (): void => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > opts.maxReportBytes) kill(new HttpError(500, "report_too_large", "the report is over the server's limit"));
      else out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      settle();
      reject(err);
    });
    child.on("close", (code) => {
      settle();
      if (failure) reject(failure);
      else if (code === 0 || code === 2) resolve(Buffer.concat(out).toString("utf8"));
      else reject(scanFailure(stderr, dir, opts.root));
    });
  });
}
