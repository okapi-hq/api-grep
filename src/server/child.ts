import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { HttpError } from "./errors.js";

export interface ChildOptions {
  /** Piped to the child's stdin; the child reads an empty stdin otherwise. */
  input?: Readable;
  /** The temporary root of the request: git never looks above it. */
  root: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  /** Aborted when the client goes away or the server stops: the child is killed. */
  signal?: AbortSignal;
  /** The answer when `timeoutMs` passes. */
  timeout: () => HttpError;
}

export interface ChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Variables a child keeps from the server: none of its secrets. */
const KEPT = ["PATH", "TMPDIR", "LANG", "API_GREP_BUILD", "API_GREP_MAX_ARCHIVE_MB", "API_GREP_MAX_UNPACKED_MB", "API_GREP_MAX_FILES"];

/**
 * A child's environment: a few variables, no heap respawn, no colors, no git (the archive could configure it), and its
 * own deadline, so a child the server could not kill (killed itself) still ends.
 */
export function childEnv(root: string, deadlineMs: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    API_GREP_NO_RESPAWN: "1",
    API_GREP_NO_GIT: "1",
    API_GREP_DEADLINE_MS: String(deadlineMs),
    NO_COLOR: "1",
    GIT_CEILING_DIRECTORIES: root,
  };
  for (const key of KEPT) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

/** `node [heap] [execArgv] <cli> <args>`: the child runs this command as the command line does. */
export function cliArgv(cli: string, args: string[], heapMb = 0): string[] {
  const heap = heapMb > 0 ? [`--max-old-space-size=${heapMb}`] : [];
  return [...heap, ...process.execArgv.filter((a) => !a.includes("max-old-space-size")), cli, ...args];
}

/** Collects a child's stdout up to `max` bytes (`over` past it) and the start of its stderr. */
function collect(child: ChildProcessWithoutNullStreams, max: number, over: () => void): () => { stdout: string; stderr: string } {
  const out: Buffer[] = [];
  let outBytes = 0;
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    outBytes += chunk.length;
    if (outBytes > max) over();
    else out.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8");
  });
  return () => ({ stdout: Buffer.concat(out).toString("utf8"), stderr });
}

/**
 * Runs node with `argv` in its own process group and resolves when the group's leader exits. A timeout, an oversized
 * output or an abort kills the whole group: no child outlives its request, and the kernel closes every file it held.
 */
export function runChild(argv: string[], opts: ChildOptions): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, { detached: true, stdio: ["pipe", "pipe", "pipe"], env: childEnv(opts.root, opts.timeoutMs + 5_000) });
    let failure: HttpError | undefined;
    const kill = (err: HttpError): void => {
      failure ??= err;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // already gone
      }
    };
    const output = collect(child, opts.maxStdoutBytes, () => kill(new HttpError(500, "report_too_large", "the report is over the server's limit")));
    const timer = setTimeout(() => kill(opts.timeout()), opts.timeoutMs);
    const onAbort = (): void => kill(new HttpError(499, "client_closed", "the client closed the connection"));
    if (opts.signal?.aborted) onAbort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    // a child that stops reading early (a refused archive) closes its stdin: the request is not read further
    child.stdin.on("error", () => undefined);
    if (opts.input) opts.input.pipe(child.stdin);
    else child.stdin.end();
    const settle = (): void => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      opts.input?.unpipe(child.stdin);
    };
    child.on("error", (err) => {
      settle();
      reject(err);
    });
    child.on("close", (code) => {
      settle();
      if (failure) reject(failure);
      else resolve({ code, ...output() });
    });
  });
}
