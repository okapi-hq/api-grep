import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { scopeOf } from "../../src/project.js";
import { findTsconfig, readRoot, repositoryRoot } from "../../src/tsconfig.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "api-grep-tsconfig-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function tree(name: string, files: Record<string, string>): string {
  const dir = path.join(tmp, name);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

const STRICT = `{ "compilerOptions": { "strict": true } }`;

describe("the tsconfig of a scan (#112)", () => {
  it("is looked for up to the repository's root", () => {
    const repo = tree("in-repo", { ".git/HEAD": "ref: refs/heads/main\n", "tsconfig.json": STRICT, "apps/web/src/a.ts": "" });
    expect(repositoryRoot(path.join(repo, "apps", "web"))).toBe(repo);
    expect(findTsconfig(path.join(repo, "apps", "web"))).toEqual({ file: path.join(repo, "tsconfig.json"), bound: repo });
  });

  it("bounds what a scan reads at the repository root, a worktree's `.git` file included, else at the scanned directory", () => {
    const parent = tree("roots", { "worktree/.git": "gitdir: /nowhere\n", "worktree/apps/web/a.ts": "", "plain/apps/web/a.ts": "" });
    expect(readRoot(path.join(parent, "worktree", "apps", "web"))).toBe(path.join(parent, "worktree"));
    expect(readRoot(path.join(parent, "plain", "apps", "web"))).toBe(path.join(parent, "plain", "apps", "web"));
    expect(scopeOf({ dir: path.join(parent, "worktree", "apps", "web") }).root).toBe(path.join(parent, "worktree"));
  });

  it("is never one above the repository or, outside any, above the scanned directory", () => {
    const parent = tree("above", { "tsconfig.json": STRICT, "repo/.git/HEAD": "ref: refs/heads/main\n", "repo/src/a.ts": "", "plain/src/a.ts": "" });
    expect(findTsconfig(path.join(parent, "repo", "src")).file).toBeUndefined();
    expect(findTsconfig(path.join(parent, "plain")).file).toBeUndefined();
    expect(findTsconfig(path.join(parent, "plain")).bound).toBe(path.join(parent, "plain"));
  });

  it("extends nothing outside that bound", () => {
    const parent = tree("extends", { "base.json": STRICT, "repo/tsconfig.json": `{ "extends": "../base.json" }`, "inside/tsconfig.json": `{ "extends": "./inner.json" }`, "inside/inner.json": STRICT });
    expect(scopeOf({ dir: path.join(parent, "repo") }).options.strict).toBeUndefined();
    expect(scopeOf({ dir: path.join(parent, "inside") }).options.strict).toBe(true);
  });
});
