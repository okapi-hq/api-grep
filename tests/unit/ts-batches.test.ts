import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Project, ts } from "ts-morph";
import { afterAll, describe, expect, it } from "vitest";
import { packBatches, projectOrder } from "../../src/lang/typescript/batches.js";
import { relieve, resetChecker } from "../../src/lang/typescript/checker-budget.js";
import { DeferredDiagnostics } from "../../src/lang/typescript/deferred.js";
import { fileGroups } from "../../src/lang/typescript/graph.js";
import { leanResolution } from "../../src/module-resolution.js";
import type { Report } from "../../src/report/schema.js";
import { scanFixture } from "../fixture-helpers.js";

const root = mkdtempSync(path.join(os.tmpdir(), "api-grep-batches-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Writes `files` under a new directory and returns their absolute paths, in the given order. */
function tree(name: string, files: Record<string, string>): string[] {
  const dir = path.join(root, name);
  return Object.entries(files).map(([rel, text]) => {
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    return file;
  });
}

/** The groups of `files` (all in scope but those named in `outside`), as sets of file names. */
function groupsOf(name: string, files: Record<string, string>, outside: string[] = [], options: ts.CompilerOptions = { allowJs: true }): string[][] {
  const all = tree(name, files);
  const inScope = all.filter((f) => !outside.includes(path.basename(f)));
  const { groups } = fileGroups({ files: inScope, options, textOf: (f) => ts.sys.readFile(f) });
  return groups.map((g) => g.map((i) => path.basename(inScope[i]!)));
}

describe("file groups (#68)", () => {
  it("links a file to what it imports, re-exports or requires, and nothing else", () => {
    const groups = groupsOf("imports", {
      "a.ts": `import { b } from "./b";\nexport const a = b;`,
      "b.ts": `export * from "./c";\nexport const b = 1;`,
      "c.ts": `export const c = 2;`,
      "d.js": `const e = require("./e");`,
      "e.js": `module.exports = {};`,
      "f.ts": `export const f = 3;`,
    });
    expect(groups).toEqual([["a.ts", "b.ts", "c.ts"], ["d.js", "e.js"], ["f.ts"]]);
  });

  it("links two files through a file outside the scope that both import", () => {
    const groups = groupsOf("outside", { "a.ts": `import { s } from "./shared";`, "b.ts": `import { s } from "./shared";`, "shared.ts": `export const s = 1;` }, ["shared.ts"]);
    expect(groups).toEqual([["a.ts", "b.ts"]]);
  });

  it("links a script's global declarations to the files that name them", () => {
    const groups = groupsOf("globals", {
      "helpers.js": `function sendLead(x) { return fetch("/lead", { method: "POST", body: x }); }`,
      "page.ts": `export function go() { sendLead(1); }`,
      "other.ts": `export const other = 1;`,
    });
    expect(groups).toEqual([["helpers.js", "page.ts"], ["other.ts"]]);
  });

  it("links a global augmentation to every file: a file can use it without naming it", () => {
    const groups = groupsOf("augmentation", {
      "aug.ts": `export {};\ndeclare global { interface Window { api: unknown } }`,
      "uses-window.ts": `export const w = window.api;`,
      "other.ts": `export const other = 1;`,
    });
    expect(groups).toEqual([["aug.ts", "uses-window.ts", "other.ts"]]);
  });
});

describe("file groups: declarations, references and paths", () => {
  it("links a declare module block to the files importing that module, wildcards included", () => {
    const groups = groupsOf("ambient", {
      "types.ts": `declare module "virtual:config" { export const url: string; }\ndeclare module "*.svg" { const s: string; export default s; }`,
      "a.ts": `import { url } from "virtual:config";`,
      "b.ts": `import logo from "./logo.svg";`,
      "c.ts": `import x from "unrelated";`,
    });
    expect(groups).toEqual([["types.ts", "a.ts", "b.ts"], ["c.ts"]]);
  });

  it("follows triple-slash references and JSDoc import types", () => {
    const groups = groupsOf("references", {
      "a.ts": `/// <reference path="./b.ts" />\nexport {};`,
      "b.ts": `export {};`,
      "c.js": `/** @param {import("./d").D} d */\nexport function f(d) {}`,
      "d.ts": `export interface D { x: string }`,
    });
    expect(groups).toEqual([["a.ts", "b.ts"], ["c.js", "d.ts"]]);
  });

  it("resolves tsconfig paths", () => {
    const groups = groupsOf(
      "paths",
      { "src/a.ts": `import { b } from "@lib/b";`, "lib/b.ts": `export const b = 1;`, "src/c.ts": `export {};` },
      [],
      { baseUrl: path.join(root, "paths"), paths: { "@lib/*": ["lib/*"] } },
    );
    expect(groups).toEqual([["a.ts", "b.ts"], ["c.ts"]]);
  });
});

describe("batches (#68)", () => {
  const files = tree("pack", { "a.ts": "x".repeat(40), "b.ts": "x".repeat(40), "c.ts": "x".repeat(200), "d.ts": "x".repeat(40) });

  it("packs groups up to the budget, a group over it alone, each batch in file order", () => {
    const batches = packBatches(files, [[1], [0], [2], [3]], 100).map((b) => b.map((f) => path.basename(f)));
    expect(batches).toEqual([["c.ts"], ["a.ts", "b.ts"], ["d.ts"]]);
  });

  it("keeps only the groups holding a changed file", () => {
    const batches = packBatches(files, [[0, 1], [2], [3]], 1_000, new Set([files[3]!]));
    expect(batches).toEqual([[files[3]]]);
  });

  it("orders files as a project of all of them does", () => {
    const paths = ["/r/z.ts", "/r/a/b/c.ts", "/r/a/y.ts", "/r/b.ts", "/r/a/b/a.ts", "/r/A.ts"];
    const project = new Project({ useInMemoryFileSystem: true });
    for (const p of paths) project.createSourceFile(p, "");
    const order = projectOrder(paths);
    expect([...order.keys()]).toEqual(project.getSourceFiles().map((sf) => sf.getFilePath()));
  });
});

describe("deferred diagnostics", () => {
  it("gives detector diagnostics then dropped calls, each file by file in rank order", () => {
    const log = new DeferredDiagnostics();
    const got: string[] = [];
    log.building.drop({ file: "b.ts", line: 1, reason: "internal-error" });
    log.detecting.unfollow({ file: "b.ts", line: 2, reason: "injected-fetch", expr: "x" });
    log.detecting.skip({ file: "a.ts", reason: "parse-error" });
    log.detecting.unfollow({ file: "b.ts", line: 1, reason: "injected-fetch", expr: "y" });
    const rank = (f: string): number => (f === "a.ts" ? 0 : 1);
    log.flush({ skip: (e) => got.push(`skip ${e.file}`), unfollow: (e) => got.push(`unfollow ${e.file}:${e.line}`), drop: (e) => got.push(`drop ${e.file}`) }, rank);
    expect(got).toEqual(["skip a.ts", "unfollow b.ts:2", "unfollow b.ts:1", "drop b.ts"]);
  });
});

describe("checker reset", () => {
  it("drops the checker and keeps the answers", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile("/a.ts", `type M = "GET" | "POST";\nexport const m: M = "GET";`);
    const decl = sf.getVariableDeclarationOrThrow("m");
    const before = decl.getType().getText();
    const checker = project.getProgram().compilerObject.getTypeChecker();
    expect(resetChecker(project)).toBe(true);
    expect(project.getProgram().compilerObject.getTypeChecker()).not.toBe(checker);
    expect(decl.getType().getText()).toBe(before);
  });

  it("is dropped on counts of types and instantiations, never on the heap", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/a.ts", `export const pairs = [1, 2].map((n) => ({ n, s: String(n) }));`).getVariableDeclarationOrThrow("pairs").getType();
    const checker = project.getProgram().compilerObject.getTypeChecker();
    expect(relieve(project, { types: 1e9, instantiations: 1e9 })).toBe(false);
    expect(project.getProgram().compilerObject.getTypeChecker()).toBe(checker);
    expect(relieve(project, { types: 1, instantiations: 1e9 })).toBe(true);
    expect(project.getProgram().compilerObject.getTypeChecker()).not.toBe(checker);
  });
});

/** The report without what differs from run to run. */
const stable = (r: Report): Report => ({ ...r, stats: { ...r.stats, durationMs: 0 } });

// a few kilobytes per batch: several projects per tree, not one per file (each project loads the lib files again)
describe("a scan in batches gives the report of a scan in one project", () => {
  it.each(["wrappers", "sdk", "resolve", "javascript", "html", "diagnostics"])("%s", async (group) => {
    const one = await scanFixture(group, { exclude: [] });
    const many = await scanFixture(group, { exclude: [], batchBytes: 1_500 });
    expect(stable(many)).toEqual(stable(one));
  }, 120_000);
});

describe("lean module resolution", () => {
  it("resolves imports as the checker's own resolution does", () => {
    const files = tree("lean", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["lib/*"] }, module: "nodenext", moduleResolution: "nodenext" } }),
      "package.json": `{ "type": "module" }`,
      "src/a.ts": `import { b } from "@lib/b";\nimport { c } from "./c.js";\nimport x from "missing";\nexport { d } from "../lib/d.js";\nexport { b, c, x };`,
      "src/c.ts": `export const c = 1;`,
      "lib/b.ts": `export const b = 1;`,
      "lib/d.ts": `export const d = 1;`,
    });
    const resolved = (project: Project): (string | undefined)[] => {
      const sf = project.addSourceFileAtPath(files[2]!);
      project.resolveSourceFileDependencies();
      return [...sf.getImportDeclarations(), ...sf.getExportDeclarations()].map((d) => d.getModuleSpecifierSourceFile()?.getFilePath());
    };
    const tsConfigFilePath = files[0]!;
    const lean = resolved(new Project({ tsConfigFilePath, skipAddingFilesFromTsConfig: true, resolutionHost: leanResolution }));
    expect(lean).toEqual(resolved(new Project({ tsConfigFilePath, skipAddingFilesFromTsConfig: true })));
    expect(lean).toEqual([files[4], files[3], undefined, files[5], undefined]);
  });
});
