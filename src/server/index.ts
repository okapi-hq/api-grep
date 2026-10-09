import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { toolVersion } from "../version.js";
import { createHandler, type ScanQuery, type Scanner } from "./app.js";
import { unpackArchive } from "./archive.js";
import { type Limits, serverConfig } from "./config.js";
import { runScan } from "./run-scan.js";

/** CLI flags of a scan, from the query (`--opt=value`, so a value is never read as another flag). */
function scanFlags(query: ScanQuery): string[] {
  const flags: string[] = [];
  if (query.languages) flags.push(`--language=${query.languages.join(",")}`);
  if (query.examples !== undefined) flags.push(`--examples=${query.examples}`);
  return flags;
}

/**
 * The scanner behind `POST /v1/scan`: unpack the body into a fresh temporary directory, scan it in a child process
 * running `cli`, and delete the directory whatever happens. Nothing of an archive outlives its request.
 */
export function archiveScanner(cli: string, limits: Limits): Scanner {
  return async (body, query, signal) => {
    const root = await mkdtemp(path.join(tmpdir(), "api-grep-serve-"));
    try {
      const dest = path.join(root, "archive");
      await mkdir(dest);
      const unpackStart = Date.now();
      const dir = await unpackArchive(body, dest, limits);
      const scanStart = Date.now();
      const options = { timeoutMs: limits.scanTimeoutMs, maxReportBytes: limits.maxReportBytes, heapMb: limits.heapMb, root, signal };
      const report = await runScan(cli, dir, scanFlags(query), options);
      return { report, timings: { unpack: scanStart - unpackStart, scan: Date.now() - scanStart } };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  };
}

function address(addr: AddressInfo): string {
  return addr.family === "IPv6" ? `[${addr.address}]:${addr.port}` : `${addr.address}:${addr.port}`;
}

/**
 * `api-grep serve`: an HTTP server that scans the archives it receives, with `cli` (this command's own script) running
 * each scan. Logs carry the route, status and duration of a request, never a path or a value from an archive.
 */
export async function serve(flags: { host?: string; port?: number }, cli: string): Promise<void> {
  const config = serverConfig(flags);
  const log = (line: string): void => void process.stdout.write(`${new Date().toISOString()} ${line}\n`);
  const handler = createHandler(config, archiveScanner(cli, config.limits), log);
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => resolve());
  });
  log(`api-grep ${toolVersion()} listening on http://${address(server.address() as AddressInfo)}${config.token ? "" : " (no token: loopback only)"}`);
  const stop = (): void => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
