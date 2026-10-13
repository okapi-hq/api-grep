import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("kotlin: Retrofit service interfaces", () => {
  it("reports each annotated method at its declaration, resolved against the base URL of the builder that creates it", async () => {
    const r = await scanFixture("kotlin/retrofit");
    expect(r).toMatchSnapshot();
    expect(r.calls.every((c) => c.client === "retrofit" && c.location.language === "kotlin")).toBe(true);
    expect(r.calls.map((c) => [c.location.file, c.location.line, c.method, c.urlTemplate])).toEqual([
      ["Catalog.kt", 17, "GET", "{env:CATALOG_URL}/v2/items/{id}"],
      // a leading `/` replaces the base URL's path, `.` is the base itself
      ["Catalog.kt", 20, "GET", "{env:CATALOG_URL}/health"],
      ["Catalog.kt", 23, "GET", "{env:CATALOG_URL}/v2/search?sort=name"],
      ["Catalog.kt", 26, "DELETE", "{env:CATALOG_URL}/v2/items/{id}"],
      ["Catalog.kt", 29, "GET", "{url}"],
      ["Catalog.kt", 32, "POST", "{env:CATALOG_URL}/v2/"],
      ["Catalog.kt", 35, "PUT", "{env:CATALOG_URL}/v2/items/{id}/name"],
      ["Catalog.kt", 39, "POST", "{env:CATALOG_URL}/v2/items/{id}/image"],
      ["Catalog.kt", 43, "GET", "{env:CATALOG_URL}/v2/items"],
      // created on an injected Retrofit while the project builds several: the host is not known
      ["Profiles.kt", 11, "GET", "{baseUrl}/profiles/{id}"],
      ["Trades.kt", 19, "GET", "https://api.example-exchange.com/api/v4/spot/trades"],
      ["Trades.kt", 25, "POST", "https://api.example-exchange.com/api/v4/orders"],
      ["Weather.kt", 12, "GET", "https://api.example-weather.com/data/2.5/weather"],
      // one interface created by two builders: one call per base URL
      ["Weather.kt", 24, "POST", "https://reports.example-weather.com/v1/reports"],
      ["Weather.kt", 24, "POST", "https://backup.example-weather.com/v1/reports"],
    ]);
  });
});

describe("kotlin: Retrofit parameters and builders", () => {
  it("reads query parameters, headers, interceptors and bodies from the annotations and the builder", async () => {
    const r = await scanFixture("kotlin/retrofit");
    // the callers' literal arguments are the values sent
    expect(at(r, "Trades.kt", 19)).toMatchObject({
      query: ["currency_pair", "limit"],
      queryShape: { properties: { currency_pair: { enum: ["BTC_USDT"] }, limit: { enum: [100] } } },
      headers: ["x-client"],
      clientParts: [{ where: "header", name: "x-client", from: "interceptor" }],
    });
    expect(at(r, "Trades.kt", 25)).toMatchObject({
      headers: ["content-type", "accept", "key", "x-client"],
      headerValues: { "content-type": "application/json", accept: "application/json" },
      bodyEncoding: "json",
      bodySource: "type",
      body: { fromType: "NewOrder", properties: { currency_pair: { type: "string" }, amount: { type: "string" } } },
    });
    expect(at(r, "Catalog.kt", 17)).toMatchObject({ hostKind: "env", envName: "CATALOG_URL", host: "api.example-catalog.com", provider: "api.example-catalog.com" });
    expect(at(r, "Catalog.kt", 23)).toMatchObject({ query: ["sort", "page"], queryShape: { properties: { sort: { enum: ["name"] } } } });
    expect(at(r, "Catalog.kt", 26)).toMatchObject({ body: { fromType: "Reason" }, bodyEncoding: "json" });
    expect(at(r, "Catalog.kt", 29)).toMatchObject({ provider: "unknown", hostKind: "unknown" });
    expect(at(r, "Catalog.kt", 32).body).toMatchObject({ fromType: "Item", properties: { display_name: { type: "string" } } });
    expect(at(r, "Catalog.kt", 35)).toMatchObject({ bodyEncoding: "form", body: { properties: { display_name: { type: "string" }, notify: { type: "boolean" } } } });
    expect(at(r, "Catalog.kt", 39)).toMatchObject({ bodyEncoding: "multipart", body: { properties: { caption: {} }, dynamicKeys: true } });
    expect(at(r, "Catalog.kt", 43)).toMatchObject({ headers: ["authorization"], authScheme: "unknown" });
    // a String body through the scalars converter is sent as text
    expect(at(r, "Weather.kt", 24)).toMatchObject({ bodyEncoding: "raw", body: { type: "string" } });
  });

  it("drops the query string of a base URL for a relative endpoint, as Retrofit does", async () => {
    const r = await scanFixture("kotlin/retrofit");
    expect(at(r, "Weather.kt", 12)).toMatchObject({ query: ["q"], authScheme: "none" });
  });
});

describe("kotlin: Retrofit created on an injected Retrofit", () => {
  it("uses the project's only Retrofit.Builder, read through comments between the steps of its chain", async () => {
    const r = await scanFixture("kotlin/retrofit-injected");
    expect(at(r, "NotesApi.kt", 12)).toMatchObject({ urlTemplate: "https://api.example-notes.com/v1/notes/{id}" });
    // a Content-Type in @Headers is what the body is sent as, whatever the converter
    expect(at(r, "NotesApi.kt", 16)).toMatchObject({ bodyEncoding: "raw", headerValues: { "content-type": "application/x-protobuf" } });
  });

  it("follows a provided Retrofit.Builder its users finish, not the project's other builder (#46)", async () => {
    const r = await scanFixture("kotlin/retrofit-shared-builder");
    expect(r.calls.map((c) => [c.location.file, c.location.line, c.urlTemplate])).toEqual([
      ["Apis.kt", 8, "https://api.example-sync.com/status"],
      ["Apis.kt", 13, "https://api.example-images.com/search"],
    ]);
  });

  it("stops on a value created from itself (`val api = retrofit.create(api)`) instead of failing the file", async () => {
    const r = await scanFixture("kotlin/retrofit-cycles");
    expect(r.diagnostics?.skipped).toEqual([]);
    expect(at(r, "Loop.kt", 7)).toMatchObject({ urlTemplate: "https://api.example-loop.com/loop" });
  });
});
