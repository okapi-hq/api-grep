import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { unpackArchive } from "../../src/server/archive.js";
import { limitsFrom } from "../../src/server/config.js";
import { HttpError } from "../../src/server/errors.js";
import { tarball, type TarEntry } from "../tarball.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Unpacks into `<root>/archive`, so a file that escaped would land in `<root>`. */
async function unpack(archive: Buffer, env: NodeJS.ProcessEnv = {}): Promise<{ root: string; dir: string }> {
  const root = mkdtempSync(path.join(tmpdir(), "api-grep-archive-"));
  roots.push(root);
  const dest = path.join(root, "archive");
  mkdirSync(dest);
  const dir = await unpackArchive(Readable.from([archive]), dest, limitsFrom(env));
  return { root, dir };
}

async function refusal(entries: TarEntry[] | Buffer, env: NodeJS.ProcessEnv = {}): Promise<HttpError> {
  const err = await unpack(Buffer.isBuffer(entries) ? entries : tarball(entries), env).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  return err as HttpError;
}

describe("unpackArchive", () => {
  it("returns the archive's single top-level directory", async () => {
    const { dir } = await unpack(tarball([{ path: "repo-abc/src/a.ts", body: "fetch('https://api.example.com')" }]));
    expect(path.basename(dir)).toBe("repo-abc");
    expect(readdirSync(dir, { recursive: true })).toEqual(["src", path.join("src", "a.ts")]);
  });

  it("returns the destination when the archive has several top-level entries", async () => {
    const { dir } = await unpack(tarball([{ path: "a.ts" }, { path: "lib/b.ts" }]));
    expect(path.basename(dir)).toBe("archive");
  });

  it("writes no link, device or git metadata", async () => {
    const { dir } = await unpack(
      tarball([
        { path: "repo/a.ts", body: "x" },
        { path: "repo/link.ts", type: "SymbolicLink", linkpath: "/etc/hostname" },
        { path: "repo/hard.ts", type: "Link", linkpath: "repo/a.ts" },
        { path: "repo/pipe", type: "FIFO" },
        { path: "repo/.git/config", body: "[core]\n\tfsmonitor = touch /tmp/pwned" },
        { path: "repo/sub/.git/hooks/post-checkout", body: "#!/bin/sh" },
      ]),
    );
    expect(readdirSync(dir, { recursive: true })).toEqual(["a.ts"]);
  });

  it("refuses an entry that climbs out with `..`, and writes nothing outside", async () => {
    const err = await refusal([{ path: "repo/../../escape.ts", body: "x" }]);
    expect(err).toMatchObject({ status: 422, code: "invalid_archive" });
    expect(err.message).not.toContain(tmpdir());
    for (const root of roots) expect(existsSync(path.join(root, "escape.ts"))).toBe(false);
  });

  it("refuses an absolute path", async () => {
    expect(await refusal([{ path: "/etc/cron.d/x", body: "x" }])).toMatchObject({ status: 422, message: "an entry has an absolute path" });
  });

  it("refuses a body that is not a gzip-compressed tar archive", async () => {
    expect(await refusal(Buffer.from("not an archive"))).toMatchObject({ status: 422, code: "invalid_archive" });
    const truncated = tarball([{ path: "repo/a.ts", body: "x".repeat(4000) }]).subarray(0, 40);
    expect(await refusal(truncated)).toMatchObject({ status: 422, code: "invalid_archive" });
  });

  it("stops at the file count, unpacked size and archive size limits", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ path: `repo/f${i}.ts`, body: "x" }));
    expect(await refusal(many, { API_GREP_MAX_FILES: "3" })).toMatchObject({ status: 413, code: "archive_too_large" });
    const big = [{ path: "repo/big.ts", body: "x".repeat(2 * 1024 * 1024) }];
    expect(await refusal(big, { API_GREP_MAX_UNPACKED_MB: "1" })).toMatchObject({ status: 413 });
    const noise = tarball([{ path: "repo/n.bin", body: randomBytes(3 * 1024 * 1024) }]);
    expect(await refusal(noise, { API_GREP_MAX_ARCHIVE_MB: "1" })).toMatchObject({ status: 413 });
  });
});
