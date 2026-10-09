import type { Readable } from "node:stream";
import { unpackArchive } from "./archive.js";
import { cliArgv, runChild } from "./child.js";
import { limitsFrom, type Limits } from "./config.js";
import { HttpError } from "./errors.js";

interface Answer {
  root?: unknown;
  error?: { status?: unknown; code?: unknown; message?: unknown };
}

function parseAnswer(stdout: string): Answer {
  try {
    return JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as Answer;
  } catch {
    return {};
  }
}

/**
 * Unpacks the request body in a child process (`api-grep unpack <dest>`). A refused or cut-off archive ends that
 * process, and with it every file it still held open, before the request's directory is removed.
 */
export async function unpackInChild(cli: string, body: Readable, dest: string, root: string, limits: Limits, signal: AbortSignal): Promise<string> {
  const result = await runChild(cliArgv(cli, ["unpack", dest]), {
    input: body,
    root,
    timeoutMs: limits.scanTimeoutMs,
    maxStdoutBytes: 64 * 1024,
    signal,
    timeout: () => new HttpError(504, "unpack_timeout", "unpacking the archive took too long"),
  });
  const answer = parseAnswer(result.stdout);
  if (result.code === 0 && typeof answer.root === "string" && answer.root.startsWith(dest)) return answer.root;
  const e = answer.error;
  if (typeof e?.status === "number" && e.status >= 400 && e.status < 600 && typeof e.code === "string" && typeof e.message === "string") {
    throw new HttpError(e.status, e.code, e.message);
  }
  throw new HttpError(500, "unpack_failed", "the archive could not be unpacked");
}

/**
 * `api-grep unpack <dest>`, the hidden command the server runs: stdin into `dest`, then one JSON line, `{ root }` or
 * `{ error }` (exit code 3). It exits at once: an aborted unpack may still hold a file open, and the exit closes it.
 */
export async function unpackCommand(dest: string): Promise<void> {
  let line: string;
  let code = 0;
  try {
    line = JSON.stringify({ root: await unpackArchive(process.stdin, dest, limitsFrom(process.env)) });
  } catch (err) {
    const e = err instanceof HttpError ? err : new HttpError(422, "invalid_archive", "the archive cannot be unpacked");
    line = JSON.stringify({ error: { status: e.status, code: e.code, message: e.message } });
    code = 3;
  }
  process.stdout.write(`${line}\n`, () => process.exit(code));
}
