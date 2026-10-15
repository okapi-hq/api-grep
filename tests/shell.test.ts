import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Call } from "../src/report/schema.js";
import { isShellFile } from "../src/lang/shell/files.js";
import { scan } from "../src/scan.js";
import { at, scanFixture } from "./fixture-helpers.js";

const props = (c: Call | undefined): Record<string, unknown> => (c?.body as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};

describe("shell: curl", () => {
  it("reads curl command lines, their variables, wrapper functions and sourced files", async () => {
    const r = await scanFixture("shell/curl");
    expect(r).toMatchSnapshot();
    expect(r.calls.every((c) => c.location.language === "shell" && c.client === "curl")).toBe(true);
    expect(at(r, "notify.sh", 9)).toMatchObject({ method: "POST", provider: "telegram", hostKind: "const", pathTemplate: "/bot{TELEGRAM_BOT_TOKEN}/sendMessage", bodyEncoding: "form" });
    expect(Object.keys(props(at(r, "notify.sh", 9)))).toEqual(["chat_id", "text", "parse_mode"]);
    expect(at(r, "notify.sh", 14)).toMatchObject({ provider: "discord", bodyEncoding: "json", body: { properties: { username: { enum: ["report-bot"] }, tts: { enum: [false] } } } });
    // inside `$(...)`, the URL from an env var
    expect(at(r, "notify.sh", 18)).toMatchObject({ provider: "slack", hostKind: "env", envName: "SLACK_WEBHOOK_URL", method: "POST" });
    // a wrapper reported at its call sites, its arguments read there
    expect(r.calls.filter((c) => c.via === "wrapper:gh_api").map((c) => [c.location.line, c.method, c.pathTemplate, c.query])).toEqual([
      [15, "GET", "/repos/acme/widgets/releases/latest", []],
      [16, "POST", "/repos/acme/widgets/issues", []],
      [17, "GET", "/repos/acme/widgets/issues", ["state", "per_page"]],
    ]);
    expect(at(r, "github.sh", 19)).toMatchObject({ method: "HEAD", hostKind: "literal" });
    // in backticks; the model a default gives, with its env var
    expect(at(r, "llm.sh", 5)).toMatchObject({ provider: "openai", authScheme: "bearer", model: { values: ["gpt-4o-mini"], env: "OPENAI_MODEL" } });
    expect(at(r, "llm.sh", 14)).toMatchObject({ provider: "anthropic", hostKind: "env", envName: "ANTHROPIC_BASE_URL", authScheme: "apikey", model: { values: ["claude-sonnet-4-5"] } });
    // loopback calls are reported, as in the other languages
    expect(at(r, "llm.sh", 19)).toMatchObject({ provider: "ollama", method: "POST" });
    expect(at(r, "llm.sh", 20)).toMatchObject({ provider: "internal", method: "GET", pathTemplate: "/health" });
    expect(at(r, "mail.bash", 2)).toMatchObject({ provider: "mailgun", authScheme: "basic", bodyEncoding: "multipart" });
    expect(at(r, "mail.bash", 9)).toMatchObject({ method: "PUT", pathTemplate: "/reports/{date}.pdf", body: { type: "unknown" } });
    // an extension-less script with a bash `#!` line, and the values of the file it sources
    expect(at(r, "deploy", 3)).toMatchObject({ urlTemplate: "https://api.render.com/v1/services/srv-example/deploys", hostKind: "const" });
    expect(r.calls.some((c) => c.location.file === "README.md")).toBe(false);
  });
});

describe("shell: wget and HTTPie", () => {
  it("reads their methods, headers, bodies and query items", async () => {
    const r = await scanFixture("shell/clients");
    expect(r).toMatchSnapshot();
    expect(r.calls.map((c) => [c.location.line, c.client, c.method, c.provider, c.bodyEncoding])).toEqual([
      [4, "wget", "GET", "github", "none"],
      [6, "wget", "POST", "api.pushover.net", "form"],
      [9, "wget", "DELETE", "cloudflare", "none"],
      [11, "httpie", "POST", "linear", "json"],
      [13, "httpie", "POST", "twilio", "form"],
      [15, "httpie", "GET", "internal", "none"],
      [17, "httpie", "PATCH", "api.example.org", "json"],
    ]);
    expect(at(r, "fetch.sh", 11).operation).toMatchObject({ protocol: "graphql", name: "viewer" });
    expect(at(r, "fetch.sh", 13)).toMatchObject({ authScheme: "basic", body: { properties: { Body: { enum: ["hello"] } } } });
  });
});

describe("shell: what is not a request", () => {
  it("reports nothing for echoed, commented, quoted and heredoc text, nor out-of-scope scripts", async () => {
    const r = await scanFixture("shell/negative", { exclude: [] });
    expect(r.calls).toEqual([]);
    expect(r.diagnostics?.languages).toEqual({ shell: { filesSeen: 1, filesScanned: 1 } });
  });
});

describe("shell: file selection", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "api-grep-shell-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const file = (name: string, text: string): string => {
    writeFileSync(path.join(dir, name), text);
    return path.join(dir, name);
  };

  it("reads .sh, .bash and .zsh files, and files of no extension with a shell #! line", () => {
    expect(isShellFile(file("a.zsh", ""))).toBe(true);
    expect(isShellFile(file("deploy", "#!/usr/bin/env bash\ncurl x\n"))).toBe(true);
    expect(isShellFile(file("hook", "#!/bin/sh -e\n"))).toBe(true);
    expect(isShellFile(file("run", "#!/usr/bin/env -S zsh -f\n"))).toBe(true);
    expect(isShellFile(file("tool", "#!/usr/bin/env python3\n"))).toBe(false);
    expect(isShellFile(file("LICENSE", "MIT License\n"))).toBe(false);
    expect(isShellFile(file("notes.txt", "#!/bin/bash\n"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("does not open a FIFO", () => {
    execFileSync("mkfifo", [path.join(dir, "pipe")]);
    expect(isShellFile(path.join(dir, "pipe"))).toBe(false);
  });
});

describe("shell: what the bash grammar cannot read", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "api-grep-shell-parse-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads the rest of a file around a small error, and reports a file mostly unread", async () => {
    writeFileSync(path.join(dir, "small.sh"), "curl https://api.example.org/a\nfoo() { ) }\ncurl https://api.example.org/b\n");
    writeFileSync(path.join(dir, "large.sh"), 'curl https://api.example.org/c\nif ! [ \\( "$A" -eq 8 \\) -o \\( "$A" -ge 20 \\) ]; then\n  echo a\nfi\n');
    const r = await scan({ dir, examples: 0 });
    expect(r.calls.map((c) => `${c.location.file} ${c.pathTemplate}`)).toEqual(["small.sh /a", "small.sh /b"]);
    expect(r.diagnostics?.skipped).toEqual([{ file: "large.sh", reason: "parse-error", detail: "syntax error at line 1" }]);
    expect(r.diagnostics?.languages).toEqual({ shell: { filesSeen: 2, filesScanned: 1 } });
  });
});
