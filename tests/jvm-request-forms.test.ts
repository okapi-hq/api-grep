import { describe, expect, it } from "vitest";
import type { Report } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

const summary = (r: Report): unknown[] => r.calls.map((c) => [c.location.file, c.location.line, c.client, c.method, c.urlTemplate]);
const parts = (r: Report, file: string, line: number): unknown => at(r, file, line).clientParts?.map((p) => `${p.name}:${p.from}`);

describe("jvm: requests started in several places, client defaults (#73)", () => {
  it("gives one call per return of a request factory and per start, and reads hosts, defaults, filters and credentials", async () => {
    const r = await scanFixture("java/request-factories");
    expect(r).toMatchSnapshot();
    // a factory with two returns, the method a static-imported constant; a target host given apart; Unirest's global
    // base URL; a switch expression
    expect(summary(r)).toEqual([
      ["Catalog.java", 24, "jaxrs-client", "GET", "https://api.example-catalog.com/{version}/items"],
      ["Catalog.java", 24, "jaxrs-client", "GET", "https://api.example-catalog.com/items"],
      ["Catalog.java", 29, "jaxrs-client", "DELETE", "https://api.example-catalog.com/{version}/items/{id}"],
      ["Catalog.java", 29, "jaxrs-client", "DELETE", "https://api.example-catalog.com/items/{id}"],
      ["Catalog.java", 33, "jaxrs-client", "GET", "https://api.example-catalog.com/{version}/stats"],
      ["Catalog.java", 33, "jaxrs-client", "GET", "https://api.example-catalog.com/stats"],
      ["Catalog.java", 46, "jaxrs-client", "DYNAMIC", ""],
      // the response type given as an anonymous `GenericType` is not a body
      ["Catalog.java", 53, "jaxrs-client", "GET", "https://api.example-catalog.com/{version}/names"],
      ["Catalog.java", 53, "jaxrs-client", "GET", "https://api.example-catalog.com/names"],
      ["Catalog.java", 58, "jaxrs-client", "DYNAMIC", ""],
      ["Ledger.java", 25, "apache-httpclient", "POST", "https://api.example-ledger.com/v2/entries"],
      ["Ledger.java", 25, "apache-httpclient", "GET", "https://api.example-ledger.com/v2/entries"],
      ["Ledger.java", 29, "apache-httpclient", "GET", "https://api.example-ledger.com/v2/balances"],
      ["Ledger.java", 33, "apache-httpclient", "GET", "https://status.example-ledger.com:8443/health"],
      ["Notices.java", 29, "unirest", "GET", "https://api.example-notices.com/v1/notices"],
      ["Notices.java", 33, "jaxrs-client", "DELETE", "https://archive.example-notices.com/v1/{id}"],
      ["Notices.java", 37, "vertx-webclient", "POST", "https://push.example-notices.com/v1/publish"],
      ["Notices.java", 45, "async-http-client", "PUT", "{url}"],
      ["Notices.java", 45, "async-http-client", "GET", "{url}"],
    ]);
    // the alternatives of one call keep the call's id first, then distinct ones
    expect(new Set(r.calls.map((c) => c.id)).size).toBe(r.calls.length);
    expect(r.calls.filter((c) => c.location.line === 53).every((c) => c.bodyEncoding === "none")).toBe(true);
    expect(parts(r, "Ledger.java", 29)).toEqual(["x-api-key:default", "x-tenant:interceptor"]);
    expect(at(r, "Ledger.java", 29)).toMatchObject({ authScheme: "apikey", headers: ["x-api-key", "x-tenant"] });
    expect(parts(r, "Notices.java", 29)).toEqual(["x-api-key:default"]);
    expect(at(r, "Notices.java", 33)).toMatchObject({ authScheme: "bearer", clientParts: [{ name: "authorization", from: "interceptor" }] });
    expect(at(r, "Notices.java", 37)).toMatchObject({ authScheme: "bearer", headers: ["authorization"] });
  });

  it("reads Kotlin `when` and `if` starts and factories, and leaves more starts than are listed as one call", async () => {
    const r = await scanFixture("kotlin/request-starts");
    expect(r).toMatchSnapshot();
    expect(summary(r)).toEqual([
      ["Relay.kt", 22, "async-http-client", "POST", "{url}"],
      ["Relay.kt", 22, "async-http-client", "DELETE", "{url}"],
      ["Relay.kt", 22, "async-http-client", "GET", "{url}"],
      ["Relay.kt", 25, "unirest", "POST", "https://api.example-relay.com/v1/copies/{id}"],
      ["Relay.kt", 25, "unirest", "GET", "https://api.example-relay.com/v1/items/{id}"],
      ["Relay.kt", 27, "apache-httpclient", "GET", "https://{region}.example-relay.com/ping"],
      ["Relay.kt", 27, "apache-httpclient", "POST", "https://api.example-relay.com/ping"],
      ["Relay.kt", 44, "async-http-client", "DYNAMIC", "{url}"],
    ]);
    // steps made on the variable after the `when` apply to every start
    expect(r.calls.filter((c) => c.location.line === 22).every((c) => c.headers.includes("x-relay"))).toBe(true);
  });
});

describe("java: Lombok builders (#73)", () => {
  it("reads @Singular adders and copies made with toBuilder()", async () => {
    const r = await scanFixture("java/lombok");
    expect(at(r, "Carts.java", 27).body).toMatchObject({
      properties: { cart_id: { type: "string" }, items: { type: "array" }, labels: { properties: { channel: { enum: ["web"] } } } },
    });
    // the copy keeps the original's fields, the new value replacing the old one
    expect(at(r, "Carts.java", 33).body).toMatchObject({ properties: { cart_id: { type: "string" }, currency: { enum: ["EUR"] } } });
  });
});
