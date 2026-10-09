import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { toolVersion } from "../version.js";
import { createHandler, type ScanQuery, type Scanner } from "./app.js";
import { type Limits, serverConfig } from "./config.js";
import { runScan } from "./run-scan.js";
import { unpackInChild } from "./unpack.js";

const TMP_PREFIX = "api-grep-serve-";
/** How long a stopping server waits for its scans to be killed and their files removed. */
const STOP_GRACE_MS = 10_000;

/** CLI flags of a scan, from the query (`--opt=value`, so a value is never read as another flag). */
function scanFlags(query: ScanQuery): string[] {
  const flags: string[] = [];
  if (query.languages) flags.push(`--language=${query.languages.join(",")}`);
  if (query.examples !== undefined) flags.push(`--examples=${query.examples}`);
  return flags;
}

/**
 * The scanner behind `POST /v1/scan`: unpack the body into a fresh temporary directory, scan it, and delete the
 * directory whatever happens. Both steps run in child processes of `cli`, killed with the request, so nothing of an
 * archive outlives it.
 */
export function archiveScanner(cli: string, limits: Limits): Scanner {
  return async (body, query, signal) => {
    const root = await mkdtemp(path.join(tmpdir(), TMP_PREFIX));
    try {
      const dest = path.join(root, "archive");
      await mkdir(dest);
      const unpackStart = Date.now();
      const dir = await unpackInChild(cli, body, dest, root, limits, signal);
      const scanStart = Date.now();
      const options = { timeoutMs: limits.scanTimeoutMs, maxReportBytes: limits.maxReportBytes, heapMb: limits.heapMb, root, signal };
      const report = await runScan(cli, dir, scanFlags(query), options);
      return { report, timings: { unpack: scanStart - unpackStart, scan: Date.now() - scanStart } };
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  };
}

/** Request directories a killed server left behind, older than any scan can run. */
async function removeLeftovers(limits: Limits): Promise<void> {
  const dir = tmpdir();
  for (const name of await readdir(dir).catch(() => [])) {
    if (!name.startsWith(TMP_PREFIX)) continue;
    const full = path.join(dir, name);
    const info = await stat(full).catch(() => null);
    if (info && Date.now() - info.mtimeMs > 2 * limits.scanTimeoutMs) await rm(full, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Keeps the scans in flight, so a stopping server can wait for their cleanup. */
function tracked(scanner: Scanner, inflight: Set<Promise<unknown>>): Scanner {
  return (body, query, signal) => {
    const run = scanner(body, query, signal);
    const done = run.then(
      () => undefined,
      () => undefined,
    );
    inflight.add(done);
    void done.then(() => inflight.delete(done));
    return run;
  };
}

function address(addr: AddressInfo): string {
  return addr.family === "IPv6" ? `[${addr.address}]:${addr.port}` : `${addr.address}:${addr.port}`;
}

/**
 * `api-grep serve`: an HTTP server that scans the archives it receives, with `cli` (this command's own script) running
 * each step. Logs carry the route, status and duration of a request, never a path or a value from an archive. On
 * SIGTERM it closes every connection, which kills the running children, and waits for their files to be removed.
 */
export async function serve(flags: { host?: string; port?: number }, cli: string): Promise<void> {
  const config = serverConfig(flags);
  await removeLeftovers(config.limits);
  const log = (line: string): void => void process.stdout.write(`${new Date().toISOString()} ${line}\n`);
  const inflight = new Set<Promise<unknown>>();
  const handler = createHandler(config, tracked(archiveScanner(cli, config.limits), inflight), log);
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => resolve());
  });
  log(`api-grep ${toolVersion()} listening on http://${address(server.address() as AddressInfo)}${config.token ? "" : " (no token: loopback only)"}`);
  const stop = (): void => {
    server.close();
    server.closeAllConnections();
    const grace = new Promise((resolve) => setTimeout(resolve, STOP_GRACE_MS).unref());
    void Promise.race([Promise.all(inflight), grace]).then(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
