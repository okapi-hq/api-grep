import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { inventorySays, matchEntries, providerClass } from "../../eval/inventory/match.js";
import { parseCsv, parseInventory, readBounded } from "../../eval/inventory/read.js";
import { listRepos } from "../../eval/inventory/repos.js";
import type { Call } from "../../src/report/schema.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "api-grep-inventory-unit-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const call = (file: string, line: number, via?: string): Call => ({ location: { file, line, col: 1, language: "typescript" }, provider: "stripe", ...(via ? { via } : {}) }) as Call;
const entry = (file: string, line: number) => ({ repo: "r", file, line, service: "", kind: "" });

describe("inventory parsing", () => {
  it("reads quoted CSV cells with commas, quotes, newlines and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
    ]);
  });

  it("accepts CSV and JSON, normalizes paths and rejects rows without a positive line", () => {
    const csv = parseInventory("﻿Repo,File,Line,Kind\nr,./src\\a.ts,3,Third-Party\nr,b.ts,0,\nr,,4,\n");
    expect(csv).toEqual({ entries: [{ repo: "r", file: "src/a.ts", line: 3, service: "", kind: "third-party" }], rejected: 2 });
    expect(parseInventory('{"entries":[{"repo":"r","file":"/a.ts","line":"7","service":"s"},{"repo":"r"}]}')).toEqual({
      entries: [{ repo: "r", file: "a.ts", line: 7, service: "s", kind: "" }],
      rejected: 1,
    });
    expect(() => parseInventory("repo,path\nr,a.ts\n")).toThrow('no "file" column');
    expect(() => parseInventory("[{ not json")).toThrow("the inventory is not valid JSON");
  });

  it("keeps a `__proto__` column a plain key", () => {
    expect(parseInventory("repo,file,line,__proto__\nr,a.ts,1,x\n").entries).toHaveLength(1);
  });

  it("refuses what is not a small regular file", () => {
    const dir = path.join(tmp, "dir");
    mkdirSync(dir);
    expect(() => readBounded(dir, 10)).toThrow("not a regular file");
    writeFileSync(path.join(tmp, "big"), "x".repeat(11));
    expect(() => readBounded(path.join(tmp, "big"), 10)).toThrow("larger than 10 bytes");
  });
});

describe("matching", () => {
  it("pairs each call once, nearest first, a direct call before a wrapper's caller", () => {
    const calls = [call("a.ts", 10), call("a.ts", 10), call("a.ts", 12, "wrapper:post"), call("a.ts", 12)];
    const m = matchEntries([entry("a.ts", 10), entry("a.ts", 10), entry("a.ts", 12), entry("a.ts", 20), entry("b.ts", 10)], calls, "", 3);
    expect(m.map((x) => x.call?.location.line)).toEqual([10, 10, 12, undefined, undefined]);
    expect(m[2]!.call!.via).toBeUndefined();
  });

  it("reads inventory paths relative to the repository when the scan covers a subdirectory", () => {
    const m = matchEntries([entry("app/a.ts", 1), entry("other/a.ts", 1)], [call("a.ts", 1)], "app", 0);
    expect(m.map((x) => [!!x.call, x.outside])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it("classifies providers and third parties", () => {
    expect(["stripe", "internal", "unknown", "env:API_URL"].map(providerClass)).toEqual(["resolved", "internal", "unknown", "env"]);
    expect(inventorySays({ ...entry("a", 1), kind: "internal", service: "stripe" })).toBe("internal");
    expect(inventorySays({ ...entry("a", 1), service: "R" })).toBe("internal");
    expect(inventorySays({ ...entry("a", 1), service: "stripe" })).toBe("third-party");
    expect(inventorySays(entry("a", 1))).toBeUndefined();
  });
});

describe("repositories", () => {
  it("lists subdirectories, or a manifest's entries, and refuses a subdir that leaves its repository", () => {
    const repos = path.join(tmp, "repos");
    mkdirSync(path.join(repos, "b", "app"), { recursive: true });
    mkdirSync(path.join(repos, "a"), { recursive: true });
    symlinkSync(tmp, path.join(repos, "link"));
    expect(listRepos(repos).map((r) => r.name)).toEqual(["a", "b"]);
    const manifest = (entries: unknown): string => {
      writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify(entries));
      return path.join(tmp, "manifest.json");
    };
    expect(listRepos(repos, manifest([{ name: "b", subdir: "app/", language: "python" }]))).toEqual([{ name: "b", dir: path.join(repos, "b", "app"), subdir: "app", language: "python" }]);
    expect(() => listRepos(repos, manifest([{ name: "b", subdir: "../a" }]))).toThrow("leaves its repository");
    expect(() => listRepos(repos, manifest([{ name: "../a" }]))).toThrow("plain directory name");
    expect(() => listRepos(repos, manifest([{ name: "a", language: "cobol" }]))).toThrow("unknown language");
    symlinkSync(tmp, path.join(repos, "a", "out"));
    expect(() => listRepos(repos, manifest([{ name: "a", subdir: "out" }]))).toThrow("leaves its repository");
  });
});
