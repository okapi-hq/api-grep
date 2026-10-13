import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Identifier } from "ts-morph";
import { describe, expect, it, vi } from "vitest";
import { scan } from "../src/scan.js";
import { at, scanFixture } from "./fixture-helpers.js";

describe("GraphQL client libraries (#54)", () => {
  it("apollo: the one HTTP link of the client's link chain, for client methods and hooks", async () => {
    const r = await scanFixture("graphql-clients/apollo");
    expect(at(r, "cakes.tsx", 6)).toMatchObject({
      client: "sdk",
      sdk: { package: "@apollo/client", chain: "useQuery" },
      provider: "api.example-bakery.com",
      method: "POST",
      urlTemplate: "https://api.example-bakery.com/graphql",
      headerValues: { "x-client-name": "storefront" },
      authScheme: "unknown",
      body: { type: "object", properties: { first: { type: "integer", enum: [12] } } },
      operation: { protocol: "graphql", name: "ListCakes", type: "query", fields: ["cakes.id", "cakes.name", "cakes.price.amount"], dynamic: false, from: "document" },
    });
    // `useApolloClient()` names no client: the project's one
    expect(at(r, "cakes.tsx", 19)).toMatchObject({ provider: "api.example-bakery.com", operation: { name: "CakeById" } });
    expect(at(r, "cakes.tsx", 23)).toMatchObject({ sdk: { chain: "mutate" }, operation: { name: "OrderCake", type: "mutation" } });
    // a subscription goes through a transport of its own: no host is guessed
    expect(at(r, "cakes.tsx", 14)).toMatchObject({ provider: "unknown", hostKind: "unknown", operation: { name: "OvenStatus", type: "subscription" } });
  });

  it("apollo: two clients leave a hook's endpoint unknown, its `client` option names one", async () => {
    const r = await scanFixture("graphql-clients/apollo-clients");
    expect(at(r, "plants.tsx", 13)).toMatchObject({ provider: "unknown", hostKind: "unknown", operation: { name: "Plants" } });
    expect(at(r, "plants.tsx", 15)).toMatchObject({ provider: "env:ADMIN_API_URL", pathTemplate: "/graphql", operation: { name: "Seeds" } });
    expect(at(r, "plants.tsx", 17)).toMatchObject({ provider: "store.example-garden.com", authScheme: "bearer", headers: ["authorization"] });
    // a document the scan cannot read is still a GraphQL operation
    expect(at(r, "plants.tsx", 19).operation).toEqual({ protocol: "graphql", name: null, dynamic: true, from: "document" });
  });

  it("urql: the client's url and fetchOptions headers, `{ query }` options", async () => {
    const r = await scanFixture("graphql-clients/urql");
    expect(at(r, "books.tsx", 13)).toMatchObject({ sdk: { package: "urql" }, provider: "api.example-library.org", authScheme: "bearer", body: { properties: { shelf: { type: "string" } } } });
    expect(at(r, "books.tsx", 25)).toMatchObject({ sdk: { chain: "mutation" }, operation: { name: "Borrow", fields: ["borrow.dueDate"] } });
    expect(at(r, "books.tsx", 21)).toMatchObject({ provider: "unknown", operation: { name: "Returns" } });
  });

  it("graphql-request: a client built in another file, the package's own request(url, document)", async () => {
    const r = await scanFixture("graphql-clients/graphql-request");
    expect(at(r, "radar.ts", 8)).toMatchObject({ sdk: { package: "graphql-request" }, provider: "graph.example-weather.net", authScheme: "apikey", operation: { name: "Radar" } });
    expect(at(r, "weather.ts", 13).headerValues).toEqual({ "x-api-key": null, "x-trace": "1" });
    expect(at(r, "weather.ts", 15)).toMatchObject({ urlTemplate: "https://stations.example-weather.net/graphql", operation: { name: "stations" } });
    expect(at(r, "weather.ts", 17)).toMatchObject({ provider: "graph.example-weather.net", operation: { name: "Sensors" } });
    expect(at(r, "weather.ts", 19)).toMatchObject({ body: { properties: { city: { enum: ["Lyon"] } } }, operation: { name: "Forecast" } });
  });

});

describe("GraphQL client libraries in Python, and bounds (#54)", () => {
  it("python gql: the transport's url and headers, also through `async with client as session`", async () => {
    const r = await scanFixture("python/graphql-clients");
    expect(at(r, "inventory.py", 25)).toMatchObject({
      sdk: { package: "gql", chain: "execute" },
      provider: "api.example-warehouse.io",
      authScheme: "bearer",
      body: { properties: { aisle: { type: "dynamic" } } },
      operation: { name: "ListBins", fields: ["bins.id", "bins.label", "bins.stock.count", "bins.stock.sku"] },
    });
    expect(at(r, "inventory.py", 34)).toMatchObject({ provider: "env:STOCK_GRAPHQL_URL", hostKind: "env", operation: { name: "StockLevels" } });
    expect(at(r, "inventory.py", 38)).toMatchObject({ provider: "unknown", operation: { name: "DockEvents", type: "subscription" } });
  });

  it("a link chain that refers to itself, and many clients, end without a guess", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "api-grep-graphql-clients-"));
    try {
      const clients = Array.from({ length: 30 }, (_, i) => `export const c${i} = new ApolloClient({ uri: "https://api${i}.example.com/graphql" });`);
      const source = [
        'import { ApolloClient, HttpLink, gql, useQuery } from "@apollo/client";',
        "let a: any = b; let b: any = a;",
        "export const looped = new ApolloClient({ link: a.concat(b) });",
        ...clients,
        "export const useThing = () => useQuery(gql`query Thing { thing }`);",
        "export const viaLoop = () => looped.query({ query: gql`query Loop { loop }` });",
      ];
      fs.writeFileSync(path.join(repo, "app.ts"), source.join("\n"));
      const r = await scan({ dir: repo, examples: 0 });
      expect(r.calls.map((c) => [c.operation?.name, c.provider])).toEqual([
        ["Thing", "unknown"],
        ["Loop", "unknown"],
      ]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("GraphQL client libraries: the cost of a large app (#54)", () => {
  it("the variables next to a document are not looked up in the callers of their function", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "api-grep-graphql-clients-"));
    const refs = vi.spyOn(Identifier.prototype, "findReferencesAsNodes");
    try {
      const source = [
        'import { ApolloClient, gql } from "@apollo/client";',
        'const client = new ApolloClient({ uri: "https://api.example-shop.com/graphql" });',
        "export function loadItem(itemId: string) {",
        "  return client.query({ query: gql`query Item($id: ID!) { item(id: $id) { id } }`, variables: { id: itemId } });",
        "}",
        'loadItem("first");',
      ];
      fs.writeFileSync(path.join(repo, "items.ts"), source.join("\n"));
      const r = await scan({ dir: repo, examples: 0 });
      // the call in `loadItem`, and the one its caller makes through it
      expect(r.calls.map((c) => [c.location.line, c.provider, c.operation?.name])).toEqual([
        [4, "api.example-shop.com", "Item"],
        [6, "api.example-shop.com", "Item"],
      ]);
      expect(r.calls[1]?.body).toMatchObject({ properties: { id: { type: "string", enum: ["first"] } } });
      expect(refs).not.toHaveBeenCalled();
    } finally {
      refs.mockRestore();
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
