import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

const summary = (r: Awaited<ReturnType<typeof scanFixture>>): unknown[] => r.calls.map((c) => [c.location.file, c.location.line, c.client, c.method, c.urlTemplate]);

describe("java: request objects sent by a client (#65)", () => {
  it("reads Apache HttpClient 4 and 5: request objects, builders, URIBuilder, entities, async and fluent", async () => {
    const r = await scanFixture("java/apache");
    expect(r).toMatchSnapshot();
    expect(r.calls.every((c) => c.client === "apache-httpclient")).toBe(true);
    expect(at(r, "Links.java", 30)).toMatchObject({ method: "POST", authScheme: "bearer", bodyEncoding: "json" });
    expect(at(r, "Links.java", 38)).toMatchObject({ method: "GET", pathTemplate: "/v1/search", query: ["q", "limit"] });
    // name-value pairs in a form entity; the charset argument is not a content type
    expect(at(r, "Links.java", 48)).toMatchObject({ bodyEncoding: "form", body: { properties: { grant_type: { enum: ["client_credentials"] } }, required: ["grant_type", "client_id", "client_secret"] } });
    // requests built by callers of a wrapper; RequestBuilder parameters are a form body for a POST
    expect(at(r, "Links.java", 53)).toMatchObject({ method: "DELETE", headers: ["x-reason"], via: "wrapper:Links.send" });
    expect(at(r, "Links.java", 57)).toMatchObject({ method: "POST", bodyEncoding: "form", body: { properties: { title: { type: "string" } } } });
    expect(at(r, "Links.java", 69)).toMatchObject({ headers: ["x-source"], bodyEncoding: "form", body: { properties: { list: { enum: ["weekly"] } } } });
    expect(at(r, "Reports.java", 28)).toMatchObject({ method: "PUT", authScheme: "apikey", bodyEncoding: "json" });
    expect(at(r, "Reports.java", 32)).toMatchObject({ bodyEncoding: "multipart", body: { properties: { kind: { enum: ["pdf"] } } } });
    expect(at(r, "Reports.java", 41)).toMatchObject({ method: "POST", pathTemplate: "/v2/ping", bodyEncoding: "json" });
  });
});

describe("java: fluent request clients (#65)", () => {
  it("reads the JAX-RS client and leaves resources and responses out", async () => {
    const r = await scanFixture("java/jaxrs");
    expect(r).toMatchSnapshot();
    expect(summary(r)).toEqual([
      ["Inventory.java", 20, "jaxrs-client", "POST", "https://api.example-stock.com/v1/items"],
      ["Inventory.java", 27, "jaxrs-client", "GET", "https://api.example-stock.com/v1/items/{sku}/count"],
      ["Inventory.java", 34, "jaxrs-client", "POST", "https://auth.example-stock.com/token"],
      ["Inventory.java", 40, "jaxrs-client", "PATCH", "https://api.example-stock.com/v1/items/{sku}"],
      ["Inventory.java", 44, "jaxrs-client", "DELETE", "https://api.example-stock.com/v1/items/{sku}"],
      ["Inventory.java", 48, "jaxrs-client", "GET", "https://api.example-stock.com/v1/items/{sku}"],
      // the wrapper's own call: its callers give the request and the method
      ["Inventory.java", 53, "jaxrs-client", "DYNAMIC", ""],
    ]);
    expect(at(r, "Inventory.java", 20)).toMatchObject({ query: ["notify"], authScheme: "bearer", bodyEncoding: "json", body: { fromType: "Item" } });
    expect(at(r, "Inventory.java", 34)).toMatchObject({ bodyEncoding: "form", body: { properties: { username: { type: "string" }, password: { type: "string" } } } });
    expect(at(r, "Inventory.java", 40)).toMatchObject({ headers: ["x-warehouse"], bodyEncoding: "json", body: { fromType: "Restock" } });
    // a response type is not an entity
    expect(at(r, "Inventory.java", 48)).toMatchObject({ via: "wrapper:Inventory.send", bodyEncoding: "none" });
  });

  it("reads AsyncHttpClient, Unirest and the Vert.x WebClient, and leaves lookalike calls out", async () => {
    const r = await scanFixture("java/clients");
    expect(r).toMatchSnapshot();
    expect(summary(r)).toEqual([
      ["Alerts.java", 21, "async-http-client", "POST", "https://api.example-alerts.com/v1/batches"],
      ["Alerts.java", 29, "async-http-client", "POST", "https://auth.example-alerts.com/token"],
      ["Alerts.java", 33, "async-http-client", "DELETE", "https://api.example-alerts.com/v1/silences/{id}"],
      ["Alerts.java", 37, "unirest", "PUT", "https://api.example-alerts.com/v1/alerts/{id}"],
      ["Alerts.java", 46, "unirest", "POST", "https://api.example-alerts.com/v1/subscribers"],
      ["Alerts.java", 50, "vertx-webclient", "POST", "https://api.example-alerts.com/v1/events"],
      ["Alerts.java", 59, "vertx-webclient", "GET", "https://api.example-alerts.com/v1/health"],
      ["Alerts.java", 65, "vertx-webclient", "POST", "http://api.example-alerts.com/v1/workers"],
      // started in two branches of a switch: one call per start (#73)
      ["Alerts.java", 78, "async-http-client", "POST", "{url}"],
      ["Alerts.java", 78, "async-http-client", "GET", "{url}"],
      ["Alerts.java", 84, "vertx-webclient", "POST", "https://search.example-alerts.com/v1/query"],
      ["Lookalikes.java", 32, "unirest", "GET", "https://api.example-alerts.com/v1/status"],
    ]);
    expect(at(r, "Alerts.java", 21)).toMatchObject({ query: ["dry_run"], bodyEncoding: "json" });
    expect(at(r, "Alerts.java", 29)).toMatchObject({ bodyEncoding: "form", body: { properties: { grant_type: { enum: ["password"] } } } });
    expect(at(r, "Alerts.java", 37)).toMatchObject({ query: ["force"], authScheme: "apikey", body: { properties: { archived: { enum: [true] } } } });
    expect(at(r, "Alerts.java", 46)).toMatchObject({ bodyEncoding: "form", body: { properties: { email: { type: "string" }, list: { enum: ["weekly"] } } } });
    expect(at(r, "Alerts.java", 50)).toMatchObject({ authScheme: "bearer", headers: ["x-source", "authorization"], bodyEncoding: "json", body: { properties: { type: { enum: ["ping"] } } } });
    expect(at(r, "Alerts.java", 59)).toMatchObject({ query: ["deep"] });
    expect(at(r, "Alerts.java", 65)).toMatchObject({ bodyEncoding: "form", body: { properties: { name: { type: "string" } } } });
  });
});

describe("java: code Lombok generates (#65)", () => {
  it("reads @Builder chains as bodies under their JSON names, and getters as fields", async () => {
    const r = await scanFixture("java/lombok");
    expect(r).toMatchSnapshot();
    expect(at(r, "Orders.java", 49)).toMatchObject({
      urlTemplate: "https://api.example-shop.com/v1/orders",
      body: { type: "object", properties: { customer_id: { type: "string" }, quantity: { enum: [2] } }, required: ["customer_id", "quantity"] },
    });
    // a @SuperBuilder sets the fields of its base class too
    expect(at(r, "Orders.java", 53).body).toMatchObject({ properties: { source: { enum: ["warehouse"] }, tracking_code: { type: "string" } } });
    expect(at(r, "Orders.java", 59)).toMatchObject({ urlTemplate: "https://api.example-shop.com/v1/refunds", body: { fromType: "Refund" } });
  });
});
