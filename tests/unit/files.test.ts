import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isConfigFile, isInside, readConfigFile, realPath, relativePosix } from "../../src/files.js";

const MIB = 1024 * 1024;

describe("relativePosix", () => {
  it("returns a slash-separated path relative to the root", () => {
    expect(relativePosix("/repo", "/repo/src/a.ts")).toBe("src/a.ts");
    expect(relativePosix("/repo", "/repo")).toBe("");
    expect(relativePosix("/repo/src", "/repo/lib/b.ts")).toBe("../lib/b.ts");
  });
});

describe("isInside", () => {
  it("accepts the root itself and paths below it", () => {
    expect(isInside("/repo", "/repo")).toBe(true);
    expect(isInside("/repo", "/repo/a")).toBe(true);
    expect(isInside("/repo/", "/repo/a/b")).toBe(true);
  });

  it("rejects siblings sharing a prefix and parents", () => {
    expect(isInside("/repo", "/repo2")).toBe(false);
    expect(isInside("/repo", "/repo2/a")).toBe(false);
    expect(isInside("/repo", "/")).toBe(false);
    expect(isInside("/repo/a", "/repo")).toBe(false);
  });
});

describe("readConfigFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "api-grep-files-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads a small regular file as text", () => {
    const file = path.join(dir, "package.json");
    fs.writeFileSync(file, '{"name":"x"}');
    expect(readConfigFile(file)).toBe('{"name":"x"}');
    expect(isConfigFile(file)).toBe(true);
  });

  it("returns undefined for a missing file or a directory", () => {
    expect(readConfigFile(path.join(dir, "missing.json"))).toBeUndefined();
    expect(readConfigFile(dir)).toBeUndefined();
    expect(isConfigFile(dir)).toBe(false);
  });

  it.skipIf(process.platform === "win32")("returns undefined for a symlink to a device", () => {
    const link = path.join(dir, "package.json");
    fs.symlinkSync("/dev/zero", link);
    expect(readConfigFile(link)).toBeUndefined();
  });

  it("reads a file of exactly 4 MiB and refuses a larger one", () => {
    const max = path.join(dir, "max.json");
    const big = path.join(dir, "big.json");
    fs.writeFileSync(max, Buffer.alloc(4 * MIB, 0x20));
    fs.writeFileSync(big, Buffer.alloc(4 * MIB + 1, 0x20));
    expect(readConfigFile(max)).toHaveLength(4 * MIB);
    expect(readConfigFile(big)).toBeUndefined();
  });

});

describe("readConfigFile and symlinks", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "api-grep-files-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("follows a symlink to a regular file", () => {
    const target = path.join(dir, "real.json");
    const link = path.join(dir, "link.json");
    fs.writeFileSync(target, "{}");
    fs.symlinkSync(target, link);
    expect(readConfigFile(link)).toBe("{}");
    expect(realPath(link)).toBe(fs.realpathSync(target));
  });

  it.skipIf(process.platform === "win32")("refuses a symlink that leads out of the root", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "api-grep-outside-"));
    const repo = path.join(dir, "repo");
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(outside, ".env"), "API_URL=https://internal.example");
    fs.writeFileSync(path.join(dir, "inside.json"), "{}");
    fs.symlinkSync(path.join(outside, ".env"), path.join(repo, ".env.example"));
    fs.symlinkSync(path.join(repo, "..", "inside.json"), path.join(repo, "up.json"));
    fs.writeFileSync(path.join(repo, "own.json"), "{}");
    expect(readConfigFile(path.join(repo, ".env.example"), repo)).toBeUndefined();
    expect(readConfigFile(path.join(repo, "up.json"), repo)).toBeUndefined();
    expect(readConfigFile(path.join(repo, "own.json"), repo)).toBe("{}");
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("realPath returns the path itself when it cannot be resolved", () => {
    const missing = path.join(dir, "nope");
    expect(realPath(missing)).toBe(missing);
  });
});
