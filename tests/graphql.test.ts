import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Report } from "../src/report/schema.js";
import { scan } from "../src/scan.js";
import { at, scanFixture } from "./fixture-helpers.js";

const operations = (r: Report, file: string, line: number) => r.calls.filter((c) => c.location.file === file && c.location.line === line).map((c) => c.operation);

describe("GraphQL: the operation and the fields it selects (#35)", () => {
  it("typescript: inline, anonymous, mutation, aliases and a helper's callers", async () => {
    const r = await scanFixture("graphql");
    expect(at(r, "orders.ts", 6)).toMatchObject({
      method: "POST",
      pathTemplate: "/admin/api/2024-01/graphql.json",
      operation: { protocol: "graphql", name: "GetOrder", type: "query", fields: ["order.customer.email", "order.id", "order.totalPriceSet.shopMoney.amount"], dynamic: false, from: "document" },
    });
    expect(at(r, "orders.ts", 14).operation).toMatchObject({ name: "locations,shop", fields: ["locations.nodes.name", "shop.currencyCode", "shop.name"] });
    expect(at(r, "orders.ts", 22).operation).toMatchObject({ name: "CancelOrder", type: "mutation" });
    expect(at(r, "orders.ts", 35).operation?.fields).toEqual(["order.customer.email", "order.totalPriceSet.shopMoney.amount"]);
    expect(at(r, "orders.ts", 54)).toMatchObject({ via: "wrapper:shopify", operation: { name: "GetProduct", fields: ["product.title"] } });
  });

  it("typescript: gql fragments, imported .graphql files and a document of several operations", async () => {
    const r = await scanFixture("graphql");
    expect(at(r, "catalog.ts", 26).operation?.fields).toEqual([
      "items.nodes.downloadUrl",
      "items.nodes.id",
      "items.nodes.price.amount",
      "items.nodes.price.currency",
      "items.nodes.title",
      "items.pageInfo.hasNextPage",
    ]);
    // `#import` brings the fragment in; a named import keeps the operation it names
    expect(at(r, "catalog.ts", 28).operation).toMatchObject({ name: "ListCategories", fields: ["categories.id", "categories.name", "categories.parent.id"] });
    expect(operations(r, "catalog.ts", 30).map((o) => o?.name)).toEqual(["GetCategory"]);
    expect(operations(r, "catalog.ts", 38).map((o) => o?.name)).toEqual(["CountCategories"]);
    expect(operations(r, "catalog.ts", 40).map((o) => [o?.name, o?.batch])).toEqual([
      ["CountItems", undefined],
      ["CountCategories", undefined],
    ]);
  });

  it("typescript: Octokit graphql(), persisted queries, GET, batches, and what is not GraphQL", async () => {
    const r = await scanFixture("graphql");
    expect(at(r, "github.ts", 6)).toMatchObject({ provider: "github", client: "sdk", operation: { name: "OpenIssues", type: "query" } });
    expect(at(r, "github.ts", 14).operation).toMatchObject({ name: "viewer", fields: ["viewer.login"] });
    expect(at(r, "github-standalone.ts", 4).operation?.name).toBe("LatestRelease");
    expect(at(r, "transport.ts", 4).operation).toEqual({ protocol: "graphql", name: "GetCart", dynamic: false, from: "body" });
    expect(at(r, "transport.ts", 10).operation).toEqual({ protocol: "graphql", name: null, dynamic: true, from: "body" });
    expect(at(r, "transport.ts", 12)).toMatchObject({ method: "GET", operation: { name: "StoreHours", fields: ["hours.close", "hours.open"] } });
    expect(operations(r, "transport.ts", 15).map((o) => [o?.name, o?.batch])).toEqual([
      ["Banner", true],
      ["Footer", true],
    ]);
    expect(at(r, "transport.ts", 23).operation).toMatchObject({ name: null, dynamic: true });
    expect(at(r, "transport.ts", 26).operation).toBeUndefined();
    expect(at(r, "transport.ts", 28).operation).toBeUndefined();
  });
});

describe("GraphQL documents with parts the scan cannot compute (#35)", () => {
  it("typescript: a computed part is not read as a field or an operation", async () => {
    const r = await scanFixture("graphql");
    // a fragment from a package the scan does not read: one operation, not a second one named after the variable
    expect(operations(r, "profile.ts", 11)).toEqual([{ protocol: "graphql", name: "GetProfile", type: "query", fields: ["profile"], dynamic: false, from: "document" }]);
    // a search text built from two values
    expect(at(r, "profile.ts", 13).operation).toBeUndefined();
  });

  it("python: an f-string of two values is a search text, not a document selecting them", async () => {
    const py = await scanFixture("python/graphql");
    expect(at(py, "tracker.py", 51)).toMatchObject({ pathTemplate: "/search" });
    expect(at(py, "tracker.py", 51).operation).toBeUndefined();
  });
});

describe("GraphQL in Python and PHP, and imported documents (#35)", () => {
  it("python and php: documents in strings, heredocs and helpers", async () => {
    const py = await scanFixture("python/graphql");
    expect(at(py, "tracker.py", 22).operation).toMatchObject({ name: "ListTickets", fields: ["team.tickets.nodes.assignee.name", "team.tickets.nodes.id", "team.tickets.nodes.title"] });
    expect(at(py, "tracker.py", 27).operation).toMatchObject({ name: "CloseTicket", type: "mutation", fields: ["ticketUpdate.success", "ticketUpdate.ticket.id", "ticketUpdate.ticket.state.name"] });
    expect(at(py, "tracker.py", 31).operation).toMatchObject({ name: "viewer", fields: ["viewer.email", "viewer.id"] });
    expect(at(py, "tracker.py", 43).operation).toEqual({ protocol: "graphql", name: "SavedView", dynamic: false, from: "body" });
    expect(at(py, "tracker.py", 47).operation).toBeUndefined();
    const php = await scanFixture("php/graphql");
    expect(at(php, "StoreClient.php", 23).operation).toMatchObject({ name: "GetProduct", fields: ["product.priceRange.min.amount", "product.title"] });
    expect(at(php, "StoreClient.php", 33).operation?.name).toBe("AddLine");
  });

  it("fragments interpolated many times per level are read once, and a document past the bound keeps its name", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "api-grep-graphql-"));
    try {
      const levels = Array.from({ length: 9 }, (_, i) => `const F${i + 1} = gql\`fragment F${i + 1} on T { a ${`\${F${i}} `.repeat(20)}}\`;`);
      const source = [
        'import { gql } from "graphql-tag";',
        "const F0 = gql`fragment F0 on T { id }`;",
        ...levels,
        "const DOC = gql`query Huge { root { ...F9 } } ${F9}`;",
        'export const f = () => fetch("https://api.example.com/graphql", { method: "POST", body: JSON.stringify({ query: DOC }) });',
      ].join("\n");
      fs.writeFileSync(path.join(repo, "api.ts"), source);
      const started = Date.now();
      const r = await scan({ dir: repo });
      expect(Date.now() - started).toBeLessThan(20_000);
      expect(r.calls[0]?.operation).toEqual({ protocol: "graphql", name: "Huge", type: "query", dynamic: false, from: "document" });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")("never reads an imported document from outside the scanned directory", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "api-grep-graphql-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "api-grep-outside-"));
    try {
      fs.writeFileSync(path.join(outside, "secret.graphql"), "query Secret { secret }");
      fs.symlinkSync(path.join(outside, "secret.graphql"), path.join(repo, "linked.graphql"));
      fs.writeFileSync(
        path.join(repo, "api.ts"),
        `import Doc from "./linked.graphql";\nexport const f = () => fetch("https://api.example.com/graphql", { method: "POST", body: JSON.stringify({ query: Doc }) });\n`,
      );
      const r = await scan({ dir: repo });
      expect(r.calls[0]?.operation).toMatchObject({ protocol: "graphql", name: null, dynamic: true });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
