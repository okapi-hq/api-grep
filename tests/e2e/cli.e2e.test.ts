import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { cli, FIXTURES, removeTempDirs, ROOT, scanJson, schemaErrors, tempRepo } from "./helpers.js";

afterAll(removeTempDirs);

const gotky = path.join(FIXTURES, "gotky");

describe("commands", () => {
  it("prints its version and help", () => {
    expect(cli(["--version"]).stdout.trim()).toBe(pkg.version);
    const help = cli(["--help"]);
    expect(help.status).toBe(0);
    for (const command of ["scan", "schema", "providers"]) expect(help.stdout).toContain(command);
  });

  it("prints the committed JSON Schema", () => {
    const r = cli(["schema"]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(JSON.parse(readFileSync(path.join(ROOT, "schema", "report.v1.json"), "utf8")));
  });

  it("prints the provider table", () => {
    const providers = JSON.parse(cli(["providers"]).stdout) as { id: string; hosts: string[] }[];
    expect(providers.find((p) => p.id === "stripe")?.hosts).toContain("api.stripe.com");
  });
});

describe("scan output", () => {
  it("writes a JSON report that validates against the published schema", () => {
    const { run, report } = scanJson(gotky);
    expect(run.status).toBe(0);
    expect(schemaErrors(report)).toEqual([]);
    expect(report).toMatchObject({ tool: "apicalls", version: pkg.version, repo: "gotky", diagnostics: { complete: true } });
    expect(report.calls.map((c) => `${c.location.file}:${c.location.line} ${c.method} ${c.host}${c.pathTemplate}`)).toContain("ky.ts:9 GET api.cal.com/v1/bookings");
  });

  it("writes the same report to --out as to stdout", () => {
    const out = path.join(tempRepo({}), "report.json");
    const run = cli(["scan", gotky, "--json", "--out", out]);
    const strip = (s: string): unknown => ({ ...(JSON.parse(s) as object), stats: undefined });
    expect(strip(readFileSync(out, "utf8"))).toEqual(strip(run.stdout));
  });

  it("prints a table per file with a summary, filtered by --min-confidence", () => {
    const all = cli(["scan", gotky]);
    expect(all.status).toBe(0);
    expect(all.stdout).toMatch(/got\.ts\s+typescript/);
    expect(all.stdout).toMatch(/\d+ calls in 2 files \(\d+ shown at confidence >= 0\.3\)/);
    expect(cli(["scan", gotky, "--min-confidence", "1"]).stdout).toMatch(/\(0 shown at confidence >= 1\)/);
  });

  it("prints runnable curl commands: comments, curl lines and their flags only", () => {
    const r = cli(["scan", gotky, "--curl"]);
    expect(r.status).toBe(0);
    const lines = r.stdout.split("\n").filter((l) => l !== "");
    expect(lines.some((l) => l.startsWith("curl -X POST 'https://api.dub.co/links'"))).toBe(true);
    for (const line of lines) expect(line).toMatch(/^(# |curl -X [A-Z]+ '| {2}(-H|--data|--data-raw|--data-urlencode|--form-string) ')/);
  });

  it("honours --examples, --no-wrappers, --include and --exclude", () => {
    expect(scanJson(gotky, ["--examples", "0"]).report.calls.every((c) => c.examples.length === 0)).toBe(true);
    const wrappers = path.join(FIXTURES, "wrappers");
    expect(scanJson(wrappers).report.calls.some((c) => c.via)).toBe(true);
    expect(scanJson(wrappers, ["--no-wrappers"]).report.calls.some((c) => c.via)).toBe(false);
    const { report } = scanJson(gotky, ["--exclude", "ky.ts"]);
    expect(report.calls.every((c) => c.location.file === "got.ts")).toBe(true);
    expect(report.diagnostics?.skipped).toEqual([{ file: "ky.ts", reason: "excluded" }]);
    expect(scanJson(gotky, ["--include", "*.{ts,tsx}", "--exclude", "got.*"]).report.calls.every((c) => c.location.file === "ky.ts")).toBe(true);
  });
});

describe("exit codes and errors", () => {
  it("exits 0 when complete, 2 when partial, 1 on a fatal error", () => {
    expect(cli(["scan", gotky, "--json"]).status).toBe(0);
    expect(cli(["scan", path.join(FIXTURES, "robustness", "bad-specifier"), "--json"]).status).toBe(2);
    const missing = cli(["scan", path.join(FIXTURES, "no-such-dir")]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("directory not found");
  });

  it("rejects invalid options before scanning", () => {
    const cases: [string[], RegExp][] = [
      [["--examples", "abc"], /--examples.*whole number/],
      [["--examples", "-1"], /--examples.*whole number/],
      [["--min-confidence", "2"], /--min-confidence.*between 0 and 1/],
      [["--validate"], /--validate requires --specs/],
      [["--tsconfig", "missing.json"], /tsconfig not found/],
    ];
    for (const [args, message] of cases) {
      const r = cli(["scan", gotky, ...args]);
      expect(r.status, args.join(" ")).toBe(1);
      expect(r.stderr).toMatch(message);
    }
  });

  it("re-runs itself with the heap APICALLS_HEAP_MB asks for, and keeps the exit code", () => {
    const respawn = { APICALLS_NO_RESPAWN: "" };
    const r = cli(["scan", path.join(FIXTURES, "robustness", "bad-specifier"), "--json"], { env: { ...respawn, APICALLS_HEAP_MB: "1024" } });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ diagnostics: { complete: false } });
    // node cannot start in a 1 MB heap: only the re-run child dies of it
    expect(cli(["scan", gotky, "--json"], { env: { ...respawn, APICALLS_HEAP_MB: "1" } }).status).not.toBe(0);
    expect(cli(["scan", gotky, "--json"], { env: { APICALLS_HEAP_MB: "1" } }).status).toBe(0);
  });
});
