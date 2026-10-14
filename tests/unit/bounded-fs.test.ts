import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ts } from "ts-morph";
import { afterAll, describe, expect, it } from "vitest";
import { BoundedFileSystem, boundedResolutionHost } from "../../src/bounded-fs.js";
import { fileGroups } from "../../src/lang/typescript/graph.js";
import { loadBatch, scopeOf } from "../../src/project.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "api-grep-bounded-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Writes `files` under a new directory `name` and returns it. */
function tree(name: string, files: Record<string, string>): string {
  const dir = path.join(tmp, name);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

const posix = process.platform !== "win32";

describe("the disk a scan's checker sees (#112)", () => {
  const parent = tree("disk", {
    "node_modules/pkg/index.d.ts": "export declare const v: string;",
    "secret.ts": `export const token = "s3cret";`,
    "outside.d.ts": "declare const OUTSIDE: string;",
    "repo/src/a.ts": `/// <reference path="../../outside.d.ts" />\nimport { v } from "pkg";\nexport const a = v;\nexport const o = OUTSIDE;`,
  });
  const root = path.join(parent, "repo");
  if (posix) symlinkSync(path.join(parent, "secret.ts"), path.join(root, "src", "link.ts"));
  const fs = new BoundedFileSystem(root);

  it("holds the scanned directory and nothing above it", () => {
    expect(fs.fileExistsSync(path.join(root, "src", "a.ts"))).toBe(true);
    expect(fs.directoryExistsSync(path.join(root, "src"))).toBe(true);
    expect(fs.readFileSync(path.join(root, "src", "a.ts"))).toContain("pkg");
    expect(fs.fileExistsSync(path.join(parent, "node_modules", "pkg", "index.d.ts"))).toBe(false);
    expect(fs.directoryExistsSync(path.join(parent, "node_modules"))).toBe(false);
    expect(fs.fileExistsSync(path.join(root, "..", "secret.ts"))).toBe(false);
    expect(() => fs.readFileSync(path.join(parent, "secret.ts"))).toThrow(/not found/i);
    expect(fs.readDirSync(parent)).toEqual([]);
    expect(fs.getCurrentDirectory()).toBe(root.split(path.sep).join("/"));
  });

  it.skipIf(!posix)("does not follow a symlink out of it", () => {
    const link = path.join(root, "src", "link.ts");
    expect(fs.fileExistsSync(link)).toBe(false);
    expect(() => fs.readFileSync(link)).toThrow();
    expect(fs.readDirSync(path.join(root, "src")).map((e) => path.basename(e.name))).toEqual(["a.ts"]);
    expect(fs.realpathSync(link)).toBe(link);
  });

  it("is read-only", () => {
    expect(() => fs.writeFileSync(path.join(root, "x.ts"), "")).toThrow();
  });

  it("leaves a package installed above the scanned directory and a file referenced there unread, and lib files loaded", () => {
    const loaded = loadBatch(scopeOf({ dir: root }), [path.join(root, "src", "a.ts")]);
    const a = loaded.project.getSourceFileOrThrow(path.join(root, "src", "a.ts"));
    expect(a.getVariableDeclarationOrThrow("a").getType().getText()).toBe("any");
    expect(a.getVariableDeclarationOrThrow("o").getType().getText()).toBe("any");
    const read = loaded.project.getProgram().compilerObject.getSourceFiles().map((sf) => sf.fileName);
    // lib files come from memory under a fixed path; nothing else from outside the root
    expect(read.filter((f) => !f.startsWith("/node_modules/typescript/lib/"))).toEqual([path.join(root, "src", "a.ts").split(path.sep).join("/")]);
    expect(read.some((f) => f.endsWith("lib.es5.d.ts"))).toBe(true);
  });

  it("resolves a package installed inside it", () => {
    const inside = tree("inside", { "node_modules/pkg/index.d.ts": "export declare const v: string;", "src/a.ts": `import { v } from "pkg";\nexport const a = v;` });
    const loaded = loadBatch(scopeOf({ dir: inside }), [path.join(inside, "src", "a.ts")]);
    expect(loaded.project.getSourceFileOrThrow(path.join(inside, "src", "a.ts")).getVariableDeclarationOrThrow("a").getType().getText()).toBe("string");
  });
});

describe("the file graph's resolution (#112)", () => {
  it("does not link two files through one above the scanned directory", () => {
    const parent = tree("graph", {
      "shared/util.ts": "export const u = 1;",
      "repo/a.ts": `import { u } from "../shared/util";\nexport const a = u;`,
      "repo/b.ts": `import { u } from "../shared/util";\nexport const b = u;`,
    });
    const files = ["a.ts", "b.ts"].map((f) => path.join(parent, "repo", f));
    const groups = (host?: ts.ModuleResolutionHost) => fileGroups({ files, options: {}, textOf: (f) => ts.sys.readFile(f), host }).groups;
    expect(groups()).toEqual([[0, 1]]);
    expect(groups(boundedResolutionHost(path.join(parent, "repo")))).toEqual([[0], [1]]);
  });
});
