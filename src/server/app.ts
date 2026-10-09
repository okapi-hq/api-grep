import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { LANGUAGE_IDS } from "../lang/index.js";
import { PROVIDERS } from "../normalize/provider.js";
import { type Language, SCHEMA_VERSION } from "../report/schema.js";
import { toolVersion } from "../version.js";
import type { ServerConfig } from "./config.js";
import { HttpError } from "./errors.js";

export interface ScanQuery {
  languages?: string[];
  examples?: number;
}

export interface ScanResult {
  /** The JSON report, as the scan printed it. */
  report: string;
  /** Milliseconds per step, sent as a `Server-Timing` header. */
  timings: Record<string, number>;
}

/** Reads the archive from the request body and scans it. */
export type Scanner = (body: IncomingMessage, query: ScanQuery, signal: AbortSignal) => Promise<ScanResult>;

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const ARCHIVE_TYPES = new Set(["application/gzip", "application/x-gzip", "application/octet-stream"]);
const MAX_EXAMPLES = 20;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Compares digests, so the comparison takes the same time whatever the token sent. */
function authorized(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true;
  const sent = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
  return timingSafeEqual(sha256(sent), sha256(token));
}

/** `?language=python,php&examples=1`: anything else is refused, so a typo never scans with defaults silently. */
export function parseQuery(params: URLSearchParams): ScanQuery {
  const query: ScanQuery = {};
  for (const key of new Set(params.keys())) {
    if (key !== "language" && key !== "examples") throw new HttpError(400, "bad_request", `unknown parameter: ${key}`);
  }
  const languages = params.getAll("language").flatMap((v) => v.split(",")).map((v) => v.trim().toLowerCase()).filter(Boolean);
  const unknown = languages.filter((l) => !LANGUAGE_IDS.includes(l as Language));
  if (unknown.length > 0) throw new HttpError(400, "bad_request", `unknown language (supported: ${LANGUAGE_IDS.join(", ")})`);
  if (languages.length > 0) query.languages = [...new Set(languages)];
  const examples = params.getAll("examples");
  if (examples.length > 0) {
    const n = Number(examples[0]);
    if (examples.length > 1 || !/^\d+$/.test(examples[0]!) || n > MAX_EXAMPLES) throw new HttpError(400, "bad_request", `examples must be a whole number from 0 to ${MAX_EXAMPLES}`);
    query.examples = n;
  }
  return query;
}

/** Refuses a body that cannot be an archive within the limit before reading any of it. */
function checkBody(req: IncomingMessage, maxArchiveBytes: number): void {
  const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (!ARCHIVE_TYPES.has(type)) throw new HttpError(415, "unsupported_media_type", "send a gzip-compressed tar archive (content-type: application/gzip)");
  const length = Number(req.headers["content-length"] ?? 0);
  if (length > maxArchiveBytes) throw new HttpError(413, "archive_too_large", "the archive is over the server's limit");
}

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(body);
}

/** An error answer. A body left unread closes the connection, so a refused upload is not read to its end. */
function sendError(req: IncomingMessage, res: ServerResponse, err: unknown, log: (line: string) => void): number {
  const e = err instanceof HttpError ? err : new HttpError(500, "internal_error", "internal error");
  if (!(err instanceof HttpError)) log(`internal error: ${err instanceof Error ? err.name : "unknown"}`);
  if (res.headersSent) {
    res.destroy();
    return e.status;
  }
  const close: Record<string, string> = req.complete ? {} : { connection: "close" };
  send(res, e.status, JSON.stringify({ error: { code: e.code, message: e.message } }), { ...e.headers, ...close });
  if (!req.complete) res.on("finish", () => req.destroy());
  return e.status;
}

function allow(req: IncomingMessage, method: string): void {
  if (req.method !== method) throw new HttpError(405, "method_not_allowed", `use ${method}`, { allow: method });
}

/** `POST /v1/scan`: the body is the archive. One scan runs at a time; a second one gets a 429. */
function scanRoute(config: ServerConfig, scanner: Scanner, state: { busy: boolean }) {
  return async (req: IncomingMessage, res: ServerResponse, params: URLSearchParams): Promise<void> => {
    allow(req, "POST");
    const query = parseQuery(params);
    checkBody(req, config.limits.maxArchiveBytes);
    if (state.busy) throw new HttpError(429, "busy", "a scan is already running: retry later", { "retry-after": "10" });
    state.busy = true;
    const gone = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) gone.abort();
    });
    try {
      const { report, timings } = await scanner(req, query, gone.signal);
      const timing = Object.entries(timings).map(([name, ms]) => `${name};dur=${ms}`).join(", ");
      send(res, 200, report, { "server-timing": timing });
    } finally {
      state.busy = false;
    }
  };
}

/** `localhost`, `127.0.0.1` and `[::1]`, with or without a port. */
function loopbackHost(header: string | undefined): boolean {
  const host = (header ?? "").trim().toLowerCase().replace(/:\d+$/, "");
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/**
 * The server's routes: `GET /v1/health` (open), `GET /v1/providers` and `POST /v1/scan` (bearer token). Without a
 * token it only answers requests addressed to localhost, so a web page cannot reach it through DNS rebinding.
 */
export function createHandler(config: ServerConfig, scanner: Scanner, log: (line: string) => void): Handler {
  const state = { busy: false };
  const scan = scanRoute(config, scanner, state);
  return async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? "/", "http://localhost");
    let status = 200;
    try {
      if (!config.token && !loopbackHost(req.headers.host)) {
        throw new HttpError(403, "forbidden_host", "without a token, the server only answers requests addressed to localhost");
      }
      if (url.pathname === "/v1/health") {
        allow(req, "GET");
        return send(res, 200, JSON.stringify({ status: "ok", tool: "api-grep", version: toolVersion(), schemaVersion: SCHEMA_VERSION, busy: state.busy }));
      }
      if (!authorized(req, config.token)) throw new HttpError(401, "unauthorized", "missing or wrong bearer token", { "www-authenticate": "Bearer" });
      if (url.pathname === "/v1/providers") {
        allow(req, "GET");
        return send(res, 200, JSON.stringify(PROVIDERS));
      }
      if (url.pathname !== "/v1/scan") throw new HttpError(404, "not_found", "no such route");
      await scan(req, res, url.searchParams);
    } catch (err) {
      status = sendError(req, res, err, log);
    }
    if (url.pathname !== "/v1/health") log(`${req.method} ${url.pathname} ${status} ${Date.now() - started}ms`);
  };
}
