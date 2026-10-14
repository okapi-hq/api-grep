import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Report } from "../src/report/schema.js";
import { scan } from "../src/scan.js";
import { at, scanFixture } from "./fixture-helpers.js";

const name = (value: string): string => `{"kind":"Name","value":"${value}"}`;
const field = (n: string, selections?: string[]): string =>
  `{"kind":"Field","name":${name(n)}${selections ? `,"selectionSet":{"kind":"SelectionSet","selections":[${selections.join(",")}]}` : ""}}`;
const operation = (n: string, selections: string[], type = "query"): string =>
  `{"kind":"OperationDefinition","operation":"${type}","name":${name(n)},"selectionSet":{"kind":"SelectionSet","selections":[${selections.join(",")}]}}`;
const fragment = (n: string, selections: string[]): string =>
  `{"kind":"FragmentDefinition","name":${name(n)},"typeCondition":{"kind":"NamedType","name":${name("T")}},"selectionSet":{"kind":"SelectionSet","selections":[${selections.join(",")}]}}`;
const spread = (n: string): string => `{"kind":"FragmentSpread","name":${name(n)}}`;
const document = (definitions: string): string => `{"kind":"Document","definitions":[${definitions}]}`;

/** Scans one file declaring `DOC` and sending `print(DOC)`. */
async function scanDocument(declarations: string): Promise<Report> {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "api-grep-graphql-ast-"));
  try {
    const source = [
      'import { print } from "graphql";',
      declarations,
      'export const f = () => fetch("https://api.example.com/graphql", { method: "POST", body: JSON.stringify({ query: print(DOC) }) });',
    ].join("\n");
    fs.writeFileSync(path.join(repo, "api.ts"), source);
    return await scan({ dir: repo });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

describe("GraphQL documents written as an AST (#56)", () => {
  it("typescript: codegen documents through print(), Apollo, graphql-request and spread fragment documents", async () => {
    const r = await scanFixture("graphql-codegen");
    expect(at(r, "invoices.tsx", 10).operation).toEqual({
      protocol: "graphql",
      name: "GetInvoice",
      type: "query",
      fields: ["invoice.customer.email", "invoice.customer.id", "invoice.number", "invoice.total.amount", "invoice.total.currency"],
      arguments: { invoice: { id: "$id" } },
      dynamic: false,
      from: "document",
    });
    // `...InvoiceRowFragmentDoc.definitions` brings the fragment's own document in
    expect(at(r, "invoices.tsx", 18).operation?.fields).toEqual(["invoices.nodes.id", "invoices.nodes.number", "invoices.nodes.status", "invoices.pageInfo.hasNextPage"]);
    expect(at(r, "invoices.tsx", 22)).toMatchObject({ provider: "api.example-invoicing.com", operation: { name: "PayInvoice", type: "mutation" } });
    expect(at(r, "invoices.tsx", 26).operation).toMatchObject({ name: "InvoiceUpdated", type: "subscription" });
    expect(at(r, "invoices.tsx", 30).operation?.name).toBe("PayInvoice");
    expect(at(r, "invoices.tsx", 33).operation).toMatchObject({ name: "viewer", fields: ["viewer.id", "viewer.name"] });
    // `kind: "Document"` alone is a body like any other
    expect(at(r, "invoices.tsx", 37).operation).toBeUndefined();
    expect(at(r, "invoices.tsx", 37).body).toMatchObject({ type: "object", properties: { kind: { enum: ["Document"] } } });
  });

  it("javascript: precompiled gql documents, unquoted keys, `loc` and `.concat()` of fragments", async () => {
    const r = await scanFixture("javascript/graphql-ast");
    expect(at(r, "catalog.js", 66).operation).toMatchObject({ name: "GetProduct", fields: ["product.price", "product.title"] });
    expect(at(r, "catalog.js", 74).operation).toMatchObject({ name: "Stock", fields: ["stock.count"] });
  });
});

describe("GraphQL AST documents from a hostile repository (#56)", () => {
  it("documents that spread each other in, and a fragment spread inside itself, are read once", async () => {
    const r = await scanDocument(
      [
        `const A = ${document(`${fragment("FA", [field("a"), spread("FA"), spread("FB")])},...B.definitions`)};`,
        `const B = ${document(`${fragment("FB", [field("b"), spread("FA")])},...A.definitions`)};`,
        `const DOC = ${document(`${operation("Loop", [field("root", [spread("FA")])])},...A.definitions`)};`,
      ].join("\n"),
    );
    // the fragment spread inside itself selects the field it sits on, as in a text document
    expect(r.calls[0]?.operation).toMatchObject({ name: "Loop", fields: ["root", "root.a", "root.b"] });
  });

  it("a document past the bounds keeps its name and leaves its fields out, quickly", async () => {
    let deep = field("leaf");
    for (let i = 0; i < 200; i++) deep = field(`f${i}`, [deep]);
    const wide = Array.from({ length: 45_000 }, (_, i) => field(`f${i}`));
    const many = Array.from({ length: 60 }, (_, i) => operation(`Op${i}`, [field("a")]));
    const started = Date.now();
    const r = await scanDocument(
      [
        `const DEEP = ${document(operation("Deep", [deep]))};`,
        `const WIDE = ${document(operation("Wide", wide))};`,
        `const MANY = ${document(many.join(","))};`,
        `const ODD = ${document(operation("Odd", [field("a")])).replace('"kind":"Field"', '"kind":"Field","__proto__":{"polluted":true}')};`,
        `const REF = ${document(operation("Ref", [field("a")])).replace('"kind":"Field"', '"kind":"Field","alias":ALIAS')};`,
        "const DOC = DEEP;",
        ...["WIDE", "MANY", "ODD", "REF"].map((doc) => `export const send${doc} = () => fetch("https://api.example.com/graphql", { method: "POST", body: JSON.stringify({ query: print(${doc}) }) });`),
      ].join("\n"),
    );
    expect(Date.now() - started).toBeLessThan(20_000);
    const ops = (line: number) => r.calls.filter((c) => c.location.line === line).map((c) => c.operation);
    expect(ops(12)).toEqual([{ protocol: "graphql", name: "Deep", type: "query", dynamic: false, from: "document" }]);
    expect(ops(8)).toEqual([{ protocol: "graphql", name: "Wide", type: "query", dynamic: false, from: "document" }]);
    // more than 50 operations: one call of an unnamed operation, as for a text document
    expect(ops(9)).toEqual([{ protocol: "graphql", name: null, dynamic: true, from: "document" }]);
    expect(ops(10)).toEqual([{ protocol: "graphql", name: "Odd", type: "query", fields: ["a"], dynamic: false, from: "document" }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // a reference inside a definition: the header still names it
    expect(ops(11)).toEqual([{ protocol: "graphql", name: "Ref", type: "query", dynamic: false, from: "document" }]);
    // each bound reached is a diagnostic (#55); a reference is not a bound
    expect(r.diagnostics?.unfollowed).toEqual([
      { file: "api.ts", line: 8, reason: "graphql-limit", detail: "ast-nodes" },
      { file: "api.ts", line: 9, reason: "graphql-limit", detail: "operations" },
      { file: "api.ts", line: 12, reason: "graphql-limit", detail: "ast-nesting" },
    ]);
    expect(r.diagnostics?.complete).toBe(false);
  });

  it("a literal past the size bound is named by its header and reported (#55)", async () => {
    const padded = document(operation("Padded", [field("a")])).replace('{"kind":"Document",', `{"kind":"Document","padding":"${"x".repeat(4_000_001)}",`);
    const r = await scanDocument(`const DOC = ${padded};`);
    expect(r.calls[0]?.operation).toEqual({ protocol: "graphql", name: "Padded", type: "query", dynamic: false, from: "document" });
    expect(r.diagnostics?.unfollowed).toEqual([{ file: "api.ts", line: 3, reason: "graphql-limit", detail: "ast-size" }]);
  });
});
