import { isIP } from "node:net";

export const MB = 1024 * 1024;

export interface Limits {
  /** Largest request body: the compressed archive. */
  maxArchiveBytes: number;
  /** Largest total size of the files unpacked from one archive. */
  maxUnpackedBytes: number;
  /** Most entries (files and directories) unpacked from one archive. */
  maxEntries: number;
  scanTimeoutMs: number;
  /** Largest JSON report a scan may print. */
  maxReportBytes: number;
  /** Heap of each scan process (`--max-old-space-size`); 0 leaves node's default. */
  heapMb: number;
}

export interface ServerConfig {
  host: string;
  port: number;
  /** Bearer token every route but `/v1/health` requires. Absent only on a loopback address. */
  token?: string;
  limits: Limits;
}

/** The token is all that guards a server reachable beyond loopback: a short one is refused. */
const MIN_TOKEN_LENGTH = 16;

function whole(env: NodeJS.ProcessEnv, name: string, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}

/** `localhost`, `::1` and `127.x.x.x`: addresses only this machine reaches. */
export function isLoopback(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || (isIP(h) === 4 && h.startsWith("127."));
}

export function limitsFrom(env: NodeJS.ProcessEnv): Limits {
  return {
    maxArchiveBytes: whole(env, "API_GREP_MAX_ARCHIVE_MB", 512) * MB,
    maxUnpackedBytes: whole(env, "API_GREP_MAX_UNPACKED_MB", 2048) * MB,
    maxEntries: whole(env, "API_GREP_MAX_FILES", 200_000),
    scanTimeoutMs: whole(env, "API_GREP_SCAN_TIMEOUT_S", 900) * 1000,
    maxReportBytes: whole(env, "API_GREP_MAX_REPORT_MB", 256) * MB,
    heapMb: whole(env, "API_GREP_HEAP_MB", 8192, 0),
  };
}

/**
 * Settings of `api-grep serve`, from its flags and the environment. Listening beyond loopback (a container, a
 * network) requires `API_GREP_TOKEN`; without one the server stays reachable from this machine only.
 */
export function serverConfig(flags: { host?: string; port?: number }, env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = flags.host ?? (env.API_GREP_HOST?.trim() || "127.0.0.1");
  const port = flags.port ?? whole(env, env.API_GREP_PORT?.trim() ? "API_GREP_PORT" : "PORT", 8080, 0, 65535);
  const token = env.API_GREP_TOKEN?.trim() || undefined;
  if (token && token.length < MIN_TOKEN_LENGTH) throw new Error(`API_GREP_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  if (!token && !isLoopback(host)) throw new Error(`set API_GREP_TOKEN to listen on ${host} (without a token, the server only listens on loopback)`);
  return { host, port, token, limits: limitsFrom(env) };
}
