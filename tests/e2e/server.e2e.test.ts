import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import type { Report } from "../../src/report/schema.js";
import { packDirectory, tarball } from "../tarball.js";
import { CLI, cli, FIXTURES, ROOT, schemaErrors } from "./helpers.js";

const TOKEN = "e2e-token-0123456789";

/** Starts `api-grep serve --port 0` and resolves with its base URL once it listens. */
function start(env: Record<string, string>): Promise<{ child: ChildProcess; base: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, "serve", "--port", "0"], { cwd: ROOT, env: { ...process.env, ...env } });
    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      const listening = /listening on (http:\/\/\S+)/.exec(out);
      if (listening) resolve({ child, base: listening[1]! });
    });
    child.on("exit", (code) => reject(new Error(`serve exited with ${code}: ${out}`)));
  });
}

let server: ChildProcess | undefined;
let base = "";
beforeAll(async () => {
  ({ child: server, base } = await start({ API_GREP_TOKEN: TOKEN, API_GREP_BUILD: "e2e1234" }));
});
afterAll(() => {
  server?.kill();
});

const scan = (body: Buffer, query = ""): Promise<Response> =>
  fetch(`${base}/v1/scan${query}`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/gzip" }, body });

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

  it("refuses a request without the token", async () => {
    expect((await fetch(`${base}/v1/scan`, { method: "POST" })).status).toBe(401);
  });

  it("refuses to listen beyond loopback without a token", () => {
    const run = cli(["serve", "--host", "0.0.0.0", "--port", "0"], { env: { API_GREP_TOKEN: "" } });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/set API_GREP_TOKEN/);
  });

  it("prints the build in its version", () => {
    expect(cli(["--version"], { env: { API_GREP_BUILD: "abc1234" } }).stdout.trim()).toBe(`${pkg.version}+abc1234`);
  });
});
