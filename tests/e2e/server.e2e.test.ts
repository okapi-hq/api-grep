import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import type { Report } from "../../src/report/schema.js";
import { packDirectory, tarball } from "../tarball.js";
import { CLI, cli, FIXTURES, ROOT, schemaErrors } from "./helpers.js";

const TOKEN = "e2e-token-0123456789";

/** A server with its own TMPDIR, so a test can see what it leaves on disk. */
interface Server {
  child: ChildProcess;
  base: string;
  tmp: string;
}

const tmps: string[] = [];
/** Starts `api-grep serve --port 0` and resolves once it listens. */
function start(env: Record<string, string>): Promise<Server> {
  const tmp = mkdtempSync(path.join(tmpdir(), "api-grep-e2e-serve-"));
  tmps.push(tmp);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, "serve", "--port", "0"], { cwd: ROOT, env: { ...process.env, TMPDIR: tmp, ...env } });
    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      const listening = /listening on (http:\/\/\S+)/.exec(out);
      if (listening) resolve({ child, base: listening[1]!, tmp });
    });
    child.on("exit", (code) => reject(new Error(`serve exited with ${code}: ${out}`)));
  });
}

/** What a request left in the server's TMPDIR. */
const leftovers = (server: Server): string[] => readdirSync(server.tmp).filter((name) => name.startsWith("api-grep-serve-"));

let server: Server;
beforeAll(async () => {
  server = await start({ API_GREP_TOKEN: TOKEN, API_GREP_BUILD: "e2e1234", API_GREP_MAX_FILES: "40" });
});
afterAll(() => {
  server?.child.kill();
  for (const tmp of tmps) rmSync(tmp, { recursive: true, force: true });
});

const scan = (body: Buffer, query = ""): Promise<Response> =>
  fetch(`${server.base}/v1/scan${query}`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/gzip" }, body });

describe("api-grep serve", () => {
  it("scans an archive into the report a scan of the directory gives", async () => {
    const res = await scan(await packDirectory(FIXTURES, "gotky"), "?examples=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("server-timing")).toMatch(/^unpack;dur=\d+, scan;dur=\d+$/);
    const report = (await res.json()) as Report;
    expect(schemaErrors(report)).toEqual([]);
    expect(report).toMatchObject({ tool: "api-grep", version: `${pkg.version}+e2e1234`, repo: "gotky" });
    expect(report.commit).toBeUndefined();
    const calls = report.calls.map((c) => `${c.location.file}:${c.location.line} ${c.method} ${c.host}${c.pathTemplate}`);
    expect(calls).toContain("ky.ts:9 GET api.cal.com/v1/bookings");
  });

});

describe("api-grep serve, with hostile archives and clients", () => {
  it("follows no link out of the archive and refuses paths that climb out", async () => {
    const linked = await scan(
      tarball([
        { path: "repo/a.ts", body: 'export const a = () => fetch("https://api.example.com/a");' },
        { path: "repo/b.ts", type: "SymbolicLink", linkpath: path.join(FIXTURES, "gotky", "ky.ts") },
      ]),
    );
    expect(((await linked.json()) as Report).calls.map((c) => c.location.file)).toEqual(["a.ts"]);
    expect((await scan(tarball([{ path: "repo/../../x.ts", body: "x" }]))).status).toBe(422);
  });

  it("leaves nothing on disk when it refuses an archive", async () => {
    const files = Array.from({ length: 30 }, (_, i) => ({ path: `repo/f${i}.ts`, body: "x" }));
    expect((await scan(tarball([{ path: "repo/../../x.ts", body: "x" }, ...files]))).status).toBe(422);
    expect((await scan(tarball([...files, ...files.map((f) => ({ ...f, path: `${f.path}.js` }))]))).status).toBe(413);
    expect(leftovers(server)).toEqual([]);
  });

  it("refuses a request without the token", async () => {
    expect((await fetch(`${server.base}/v1/scan`, { method: "POST" })).status).toBe(401);
  });

  it("refuses to listen beyond loopback without a token", () => {
    const run = cli(["serve", "--host", "0.0.0.0", "--port", "0"], { env: { API_GREP_TOKEN: "" } });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/set API_GREP_TOKEN/);
  });

  it("kills its children and removes their files when it stops", async () => {
    const stopping = await start({ API_GREP_TOKEN: TOKEN });
    const body = tarball([{ path: "repo/big.bin", body: randomBytes(4 * 1024 * 1024) }]);
    const req = request(`${stopping.base}/v1/scan`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/gzip", "content-length": String(body.length) },
    });
    req.on("error", () => undefined);
    req.write(body.subarray(0, body.length / 2));
    await expect.poll(() => leftovers(stopping).length, { timeout: 10_000 }).toBe(1);
    const exited = new Promise<number | null>((resolve) => stopping.child.on("exit", resolve));
    stopping.child.kill("SIGTERM");
    expect(await exited).toBe(0);
    expect(leftovers(stopping)).toEqual([]);
  });

  it("prints the build in its version", () => {
    expect(cli(["--version"], { env: { API_GREP_BUILD: "abc1234" } }).stdout.trim()).toBe(`${pkg.version}+abc1234`);
  });
});
