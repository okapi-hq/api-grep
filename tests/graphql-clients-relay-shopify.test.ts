import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scan } from "../src/scan.js";
import { at, scanFixture } from "./fixture-helpers.js";

async function scanSource(files: Record<string, string>): Promise<Awaited<ReturnType<typeof scan>>> {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "api-grep-graphql-67-"));
  try {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(repo, name), text);
    return await scan({ dir: repo, examples: 0 });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

describe("Relay (#67)", () => {
  it("hooks and commitMutation / fetchQuery go to the fetch of the network layer's function", async () => {
    const r = await scanFixture("graphql-clients/relay");
    expect(at(r, "Garden.tsx", 8)).toMatchObject({
      client: "sdk",
      sdk: { package: "react-relay", chain: "useLazyLoadQuery" },
      provider: "api.example-garden.dev",
      urlTemplate: "https://api.example-garden.dev/graphql",
      method: "POST",
      authScheme: "bearer",
      headerValues: { "content-type": "application/json", authorization: null },
      body: { properties: { bed: { type: "string" } } },
      operation: { protocol: "graphql", name: "PlantListQuery", type: "query", fields: ["bed.plants", "bed.plants.id", "bed.plants.name"], from: "document" },
    });
    expect(at(r, "Garden.tsx", 16)).toMatchObject({ sdk: { chain: "useMutation" }, operation: { name: "WaterPlantMutation", type: "mutation" } });
    // the environment from `useRelayEnvironment()` is the app's one
    expect(at(r, "Garden.tsx", 22)).toMatchObject({ sdk: { chain: "commitMutation" }, provider: "api.example-garden.dev", body: { properties: { id: { type: "string" } } } });
    expect(at(r, "Garden.tsx", 25)).toMatchObject({ sdk: { package: "relay-runtime", chain: "fetchQuery" }, provider: "api.example-garden.dev", operation: { name: "ForecastQuery" } });
    // a subscription goes through the network layer's subscribe function: no host is guessed
    expect(at(r, "Garden.tsx", 28)).toMatchObject({ provider: "unknown", hostKind: "unknown", operation: { name: "FrostAlertSubscription", type: "subscription" } });
  });

  it("compiled artifacts: the text of `params`, or the header of a persisted query", async () => {
    const r = await scanFixture("graphql-clients/relay");
    expect(at(r, "Garden.tsx", 11).operation).toEqual({ protocol: "graphql", name: "SeedListQuery", type: "query", fields: ["seeds.id", "seeds.label"], arguments: { seeds: { first: "$first" } }, dynamic: false, from: "document" });
    expect(at(r, "Garden.tsx", 13).operation).toEqual({ protocol: "graphql", name: "CompostQuery", type: "query", dynamic: false, from: "document" });
  });

  it("a network layer that does not send with `fetch`, or with several, leaves the host unknown", async () => {
    const r = await scanFixture("graphql-clients/relay-unread");
    expect(at(r, "environment.ts", 10)).toMatchObject({ provider: "unknown", hostKind: "unknown", operation: { name: "OrdersQuery" } });
    const two = await scanSource({
      "env.ts": [
        'import { Environment, Network, RecordSource, Store } from "relay-runtime";',
        'import { graphql, useLazyLoadQuery } from "react-relay";',
        "const send = (params: any, variables: any) =>",
        '  params.operationKind === "mutation" ? fetch("https://write.example-mill.dev/graphql", { method: "POST" }) : fetch("https://read.example-mill.dev/graphql", { method: "POST" });',
        "// functions calling each other end the search, they do not loop",
        "function a(): unknown { return b(); }",
        "function b(): unknown { return a(); }",
        "export const env = new Environment({ network: Network.create(send), store: new Store(new RecordSource()) });",
        "export const looped = new Environment({ network: Network.create(a), store: new Store(new RecordSource()) });",
        "export const useFlour = () => useLazyLoadQuery(graphql`query FlourQuery { flour { kind } }`, {});",
      ].join("\n"),
    });
    expect(two.calls.filter((c) => c.client === "sdk").map((c) => [c.operation?.name, c.provider])).toEqual([["FlourQuery", "unknown"]]);
  });
});

describe("Shopify's GraphQL clients (#67)", () => {
  it("the admin context of an app, `clients.Graphql`, and the API clients, at the shop's host", async () => {
    const r = await scanFixture("graphql-clients/shopify");
    expect(at(r, "app.teas.tsx", 5)).toMatchObject({
      client: "sdk",
      sdk: { package: "@shopify/shopify-app-remix", chain: "admin.graphql" },
      provider: "shopify",
      host: "{shop}.myshopify.com",
      pathTemplate: "/admin/api/{version}/graphql.json",
      method: "POST",
      authScheme: "apikey",
      body: { properties: { first: { type: "integer", enum: [10] } } },
      operation: { name: "ListTeas", type: "query", fields: ["products.nodes.id", "products.nodes.title"] },
    });
    expect(at(r, "app.teas.tsx", 15)).toMatchObject({ sdk: { chain: "admin.graphql" }, operation: { name: "Restock", type: "mutation" } });
    expect(at(r, "sync.ts", 7)).toMatchObject({ sdk: { package: "@shopify/shopify-api", chain: "clients.Graphql.request" }, pathTemplate: "/admin/api/2024-07/graphql.json" });
    // the older `query({ data })`
    expect(at(r, "sync.ts", 12)).toMatchObject({ sdk: { chain: "clients.Graphql.query" }, operation: { name: "TagOrder", type: "mutation" } });
    expect(at(r, "sync.ts", 17)).toMatchObject({ pathTemplate: "/api/2024-07/graphql.json", operation: { name: "Menu" } });
    expect(at(r, "clients.ts", 10)).toMatchObject({ sdk: { package: "@shopify/admin-api-client" }, pathTemplate: "/admin/api/2025-01/graphql.json", body: { properties: { id: { type: "string" } } } });
    expect(at(r, "clients.ts", 12)).toMatchObject({ sdk: { package: "@shopify/storefront-api-client" }, pathTemplate: "/api/2025-01/graphql.json", operation: { name: "CreateCart" } });
    expect(at(r, "clients.ts", 17)).toMatchObject({ sdk: { package: "shopify-api-node", chain: "graphql" }, pathTemplate: "/admin/api/2024-10/graphql.json", operation: { name: "ShopName" } });
    // the REST client of the same package sends no GraphQL operation
    expect(r.calls.some((c) => c.location.file === "clients.ts" && c.location.line === 15)).toBe(false);
  });
});

describe("Python: sgqlc and ShopifyAPI (#67)", () => {
  it("sgqlc: the endpoint's URL and headers, operations built with `Operation` or written as text", async () => {
    const r = await scanFixture("python/graphql-shopify-sgqlc");
    expect(at(r, "tracker.py", 20)).toMatchObject({
      sdk: { package: "sgqlc", chain: "()" },
      provider: "api.example-tracker.dev",
      authScheme: "bearer",
      operation: {
        name: "OpenTickets",
        type: "query",
        fields: [
          "project.tickets.nodes.assignee.displayName",
          "project.tickets.nodes.assignee.login",
          "project.tickets.nodes.createdAt",
          "project.tickets.nodes.number",
          "project.tickets.pageInfo",
        ],
      },
    });
    expect(at(r, "tracker.py", 27)).toMatchObject({ provider: "env:TRACKER_GRAPHQL_URL", body: { properties: { id: { type: "dynamic" } } }, operation: { name: "closeTicket", type: "mutation" } });
    expect(at(r, "tracker.py", 31)).toMatchObject({ provider: "unknown", operation: { name: "TicketTitles" } });
  });

  it("ShopifyAPI: `GraphQL().execute` at the shop's host", async () => {
    const r = await scanFixture("python/graphql-shopify-sgqlc");
    expect(at(r, "shop.py", 11)).toMatchObject({
      sdk: { package: "ShopifyAPI", chain: "execute" },
      provider: "shopify",
      urlTemplate: "https://{shop}.myshopify.com/admin/api/{version}/graphql.json",
      body: { properties: { threshold: { type: "dynamic" } } },
      operation: { name: "LowStock", fields: ["productVariants.nodes.inventoryQuantity", "productVariants.nodes.sku"] },
    });
    expect(at(r, "shop.py", 16)).toMatchObject({ operation: { name: "shop", fields: ["shop.currencyCode", "shop.name"] } });
  });
});
