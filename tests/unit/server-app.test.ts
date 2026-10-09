import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandler, parseQuery, type Scanner, type ScanQuery } from "../../src/server/app.js";
import { limitsFrom, type ServerConfig } from "../../src/server/config.js";
import { HttpError } from "../../src/server/errors.js";

const TOKEN = "test-token-0123456789";
const config: ServerConfig = { host: "127.0.0.1", port: 0, token: TOKEN, limits: limitsFrom({ API_GREP_MAX_ARCHIVE_MB: "1" }) };

/** What the fake scanner saw, and how the next scan ends. */
const calls: ScanQuery[] = [];
const logs: string[] = [];
let next: () => Promise<{ report: string; timings: Record<string, number> }> = () => Promise.resolve({ report: "{}", timings: {} });
const scanner: Scanner = async (body, query) => {
  calls.push(query);
  await new Promise((resolve) => body.on("end", resolve).resume());
  return next();
};

let server: Server;
let base: string;
beforeAll(async () => {
  const handler = createHandler(config, scanner, (line) => logs.push(line));
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const auth = { authorization: `Bearer ${TOKEN}` };
const archive = { ...auth, "content-type": "application/gzip" };
const post = (query = "", headers: Record<string, string> = archive, body = "archive"): Promise<Response> =>
  fetch(`${base}/v1/scan${query}`, { method: "POST", headers, body });

async function errorOf(res: Response): Promise<{ status: number; code: string }> {
  const body = (await res.json()) as { error: { code: string } };
  return { status: res.status, code: body.error.code };
}

describe("routes", () => {
  it("answers health without a token", async () => {
    const res = await fetch(`${base}/v1/health`);
    expect(await res.json()).toMatchObject({ status: "ok", tool: "api-grep", busy: false });
  });

  it("requires the bearer token everywhere else", async () => {
    expect(await errorOf(await fetch(`${base}/v1/providers`))).toEqual({ status: 401, code: "unauthorized" });
    expect((await fetch(`${base}/v1/providers`, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    const providers = (await (await fetch(`${base}/v1/providers`, { headers: auth })).json()) as { id: string }[];
    expect(providers.some((p) => p.id === "stripe")).toBe(true);
  });

  it("answers 404 and 405 for unknown routes and methods", async () => {
    expect(await errorOf(await fetch(`${base}/v2/scan`, { headers: auth }))).toEqual({ status: 404, code: "not_found" });
    const res = await fetch(`${base}/v1/scan`, { headers: auth });
    expect(res.headers.get("allow")).toBe("POST");
    expect(await errorOf(res)).toEqual({ status: 405, code: "method_not_allowed" });
  });
});

describe("POST /v1/scan", () => {
  it("returns the report with its timings and passes the options on", async () => {
    next = () => Promise.resolve({ report: '{"tool":"api-grep"}', timings: { unpack: 3, scan: 40 } });
    const res = await post("?language=python,PHP&language=python&examples=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("server-timing")).toBe("unpack;dur=3, scan;dur=40");
    expect(await res.json()).toEqual({ tool: "api-grep" });
    expect(calls.at(-1)).toEqual({ languages: ["python", "php"], examples: 1 });
    expect(logs.at(-1)).toMatch(/^POST \/v1\/scan 200 \d+ms$/);
  });

  it("refuses a wrong content type and a declared size over the limit before reading", async () => {
    expect(await errorOf(await post("", { ...auth, "content-type": "application/json" }))).toEqual({ status: 415, code: "unsupported_media_type" });
    const big = await post("", { ...archive, "content-length": String(2 * 1024 * 1024) }, "x".repeat(2 * 1024 * 1024));
    expect(await errorOf(big)).toEqual({ status: 413, code: "archive_too_large" });
  });

  it("answers 429 while a scan runs", async () => {
    let finish: () => void = () => undefined;
    next = () => new Promise((resolve) => (finish = () => resolve({ report: "{}", timings: {} })));
    const first = post();
    await new Promise((r) => setTimeout(r, 50));
    const second = await post();
    expect(second.headers.get("retry-after")).toBe("10");
    expect(await errorOf(second)).toEqual({ status: 429, code: "busy" });
    finish();
    expect((await first).status).toBe(200);
  });

  it("answers the scanner's own errors, and hides unexpected ones", async () => {
    next = () => Promise.reject(new HttpError(504, "scan_timeout", "too long"));
    expect(await errorOf(await post())).toEqual({ status: 504, code: "scan_timeout" });
    next = () => Promise.reject(new Error("/tmp/secret/path"));
    const res = await post();
    expect(await res.text()).not.toContain("/tmp/secret");
    expect(res.status).toBe(500);
    expect(logs).toContain("internal error: Error");
  });
});

describe("without a token", () => {
  /** A raw request, so the test sets the Host header a browser would send. */
  function get(port: number, host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/v1/health", headers: { host } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
  }

  it("answers only requests addressed to localhost", async () => {
    const open = createServer((req, res) => void createHandler({ ...config, token: undefined }, scanner, () => undefined)(req, res));
    await new Promise<void>((resolve) => open.listen(0, "127.0.0.1", resolve));
    const { port } = open.address() as AddressInfo;
    try {
      expect(await get(port, `localhost:${port}`)).toBe(200);
      expect(await get(port, `127.0.0.1:${port}`)).toBe(200);
      expect(await get(port, "attacker.example")).toBe(403);
    } finally {
      await new Promise<void>((resolve) => open.close(() => resolve()));
    }
  });
});

describe("parseQuery", () => {
  const parse = (q: string): ScanQuery => parseQuery(new URLSearchParams(q));

  it("reads languages and examples", () => {
    expect(parse("")).toEqual({});
    expect(parse("language=typescript,javascript&examples=0")).toEqual({ languages: ["typescript", "javascript"], examples: 0 });
  });

  it("refuses unknown parameters, languages and example counts", () => {
    for (const q of ["exclude=**", "language=cobol", "examples=-1", "examples=21", "examples=1&examples=2", "examples=1e2"]) {
      expect(() => parse(q), q).toThrow(HttpError);
    }
  });
});
