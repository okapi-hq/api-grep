import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Report, UnfollowedCall } from "../src/report/schema.js";
import { scan } from "../src/scan.js";
import { at, scanFixture } from "./fixture-helpers.js";

/** The `graphql-limit` diagnostics of a report, as `file:line detail`. */
const limits = (r: Report): string[] =>
  (r.diagnostics?.unfollowed ?? []).filter((u: UnfollowedCall) => u.reason === "graphql-limit").map((u) => `${u.file}:${u.line} ${u.detail}`);

/** Scans a repository of the given files, written to a temporary directory: the large documents are built here. */
async function scanFiles(files: Record<string, string>): Promise<Report> {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "api-grep-graphql-limits-"));
  try {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(repo, name), text);
    return await scan({ dir: repo, examples: 0 });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

const URL = "https://api.example-warehouse.dev/graphql";
const fields = (n: number): string => Array.from({ length: n }, (_, i) => `f${i}`).join(" ");
/** Over 100,000 characters. */
const big = (name: string): string => `query ${name} { shelf { ${"bin ".repeat(26_000)}} }`;
/** 7 tokens in 7 characters: past 50,000 tokens within 100,000 characters. */
const tokens = (name: string): string => `query ${name} { ${"x(a:$b)".repeat(8_000)} }`;

const tsSend = (doc: string): string => `export const send = () => fetch("${URL}", { method: "POST", body: JSON.stringify({ query: ${doc} }) });\n`;
/** Fragments interpolated 20 times per level, 9 levels: the document of `DOC` is built from too many parts. */
const LEVELS = Array.from({ length: 9 }, (_, i) => `const F${i + 1} = gql\`fragment F${i + 1} on T { a ${`\${F${i}} `.repeat(20)}}\`;`);

/** TypeScript documents past the size, token, field path and part bounds, written in code or imported. */
const tsFiles = (): Record<string, string> => ({
  "size.ts": `import { gql } from "graphql-tag";\nconst DOC = gql\`${big("BigShelf")}\`;\n${tsSend("DOC")}`,
  "string.ts": `const DOC = "${big("BigString")}";\n${tsSend("DOC")}`,
  "tokens.ts": `const DOC = \`${tokens("ManyTokens")}\`;\n${tsSend("DOC")}`,
  "fields.ts": `const DOC = "query WideShelf { shelf { ${fields(2_001)} } }";\n${tsSend("DOC")}`,
  "parts.ts": ['import { gql } from "graphql-tag";', "const F0 = gql`fragment F0 on T { id }`;", ...LEVELS, "const DOC = gql`query Huge { root { ...F9 } } ${F9}`;", tsSend("DOC")].join("\n"),
  "big.graphql": big("ImportedShelf"),
  "imported.ts": `import DOC from "./big.graphql";\n${tsSend("DOC")}`,
});

/** Python documents past the size, token and field path bounds, and an sgqlc operation of 2,002 selections. */
const pyFiles = (): Record<string, string> => ({
  "client.py": [
    "import requests",
    `DOC = "${big("BigShelf")}"`,
    `TOKENS = "${tokens("ManyTokens")}"`,
    `WIDE = "query WideShelf { shelf { ${fields(2_001)} } }"`,
    "def a():",
    `    return requests.post("${URL}", json={"query": DOC})`,
    "def b():",
    `    return requests.post("${URL}", json={"query": TOKENS})`,
    "def c():",
    `    return requests.post("${URL}", json={"query": WIDE})`,
    "",
  ].join("\n"),
  "builder.py": [
    "from sgqlc.endpoint.http import HTTPEndpoint",
    "from sgqlc.operation import Operation",
    "from .schema import warehouse as schema",
    "def everything():",
    `    endpoint = HTTPEndpoint("${URL}")`,
    '    op = Operation(schema.Query, name="Everything")',
    "    shelf = op.shelf()",
    ...Array.from({ length: 2_001 }, (_, i) => `    shelf.f${i}()`),
    "    return endpoint(op)",
    "",
  ].join("\n"),
});

describe("GraphQL documents past a bound are reported in diagnostics: fixtures (#55)", () => {
  it("typescript fixture: nesting, fragment expansion and operation count; a document within bounds adds nothing", async () => {
    const r = await scanFixture("graphql-limits");
    expect(at(r, "limits.ts", 44).operation).toEqual({ protocol: "graphql", name: "DeepShelf", type: "query", dynamic: false, from: "document" });
    expect(at(r, "limits.ts", 45).operation).toMatchObject({ name: "ExpandedShelf" });
    expect(at(r, "limits.ts", 46).operation).toEqual({ protocol: "graphql", name: null, dynamic: true, from: "document" });
    expect(at(r, "limits.ts", 47).operation?.fields).toEqual(["shelf.id"]);
    expect(limits(r)).toEqual(["limits.ts:44 depth", "limits.ts:45 fragment-expansion", "limits.ts:46 operations"]);
    expect(r.diagnostics?.complete).toBe(false);
  });

  it("python fixture: the same bounds", async () => {
    const r = await scanFixture("python/graphql-limits");
    expect(at(r, "limits.py", 46).operation).toMatchObject({ name: "DeepShelf", type: "query" });
    expect(at(r, "limits.py", 46).operation?.fields).toBeUndefined();
    expect(at(r, "limits.py", 54).operation).toMatchObject({ name: null });
    expect(at(r, "limits.py", 58).operation?.fields).toEqual(["shelf.id"]);
    expect(limits(r)).toEqual(["limits.py:46 depth", "limits.py:50 fragment-expansion", "limits.py:54 operations"]);
    expect(r.diagnostics?.complete).toBe(false);
  });
});

describe("GraphQL documents past a bound are reported in diagnostics: generated documents (#55)", () => {
  it("typescript: size, tokens, field paths, interpolated parts and imported files", async () => {
    const r = await scanFiles(tsFiles());
    const names = Object.fromEntries(r.calls.map((c) => [c.location.file, c.operation?.name]));
    expect(names).toEqual({ "size.ts": "BigShelf", "string.ts": "BigString", "tokens.ts": "ManyTokens", "fields.ts": "WideShelf", "parts.ts": "Huge", "imported.ts": "ImportedShelf" });
    expect(r.calls.every((c) => c.operation?.fields === undefined)).toBe(true);
    expect(limits(r).sort()).toEqual([
      "fields.ts:2 fields",
      "imported.ts:2 document-size",
      `parts.ts:${LEVELS.length + 4} document-parts`,
      "size.ts:3 document-size",
      "string.ts:2 document-size",
      "tokens.ts:2 tokens",
    ]);
    expect(r.diagnostics?.complete).toBe(false);
  });

  it("python: size, tokens, field paths and an sgqlc operation of too many selections", async () => {
    const r = await scanFiles(pyFiles());
    const names = Object.fromEntries(r.calls.map((c) => [`${c.location.file}:${c.location.line}`, c.operation?.name]));
    expect(names).toEqual({ "client.py:6": "BigShelf", "client.py:8": "ManyTokens", "client.py:10": "WideShelf", "builder.py:2009": "Everything" });
    // sgqlc's own bound keeps the first 2,000 selections (`shelf` and 1,999 fields under it), which the document holds
    expect(at(r, "builder.py", 2009).operation?.fields).toHaveLength(1_999);
    expect(limits(r).sort()).toEqual(["builder.py:2009 fields", "client.py:10 fields", "client.py:6 document-size", "client.py:8 tokens"]);
    expect(r.diagnostics?.complete).toBe(false);
  });

  it("a document the code does not hold, or one built with computed parts, is no bound reached", async () => {
    const r = await scanFiles({
      "persisted.ts": `export const send = () => fetch("${URL}", { method: "POST", body: JSON.stringify({ operationName: "GetCart", extensions: { persistedQuery: { version: 1, sha256Hash: "abc" } } }) });\n`,
      "computed.ts": `export const send = (id: string) => fetch("${URL}", { method: "POST", body: JSON.stringify({ query: \`query GetShelf { shelf(id: \${id}) { id } }\` }) });\n`,
    });
    expect(r.calls).toHaveLength(2);
    expect(limits(r)).toEqual([]);
    expect(r.diagnostics?.complete).toBe(true);
  });
});
