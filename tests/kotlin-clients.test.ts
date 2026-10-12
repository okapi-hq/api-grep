import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("kotlin: OkHttp", () => {
  it("reads request builders, URL builders, JSON, form and multipart bodies, and wrappers", async () => {
    const r = await scanFixture("kotlin/okhttp");
    expect(r).toMatchSnapshot();
    expect(r.calls.every((c) => c.location.language === "kotlin" && c.client === "okhttp")).toBe(true);
    expect(at(r, "Balances.kt", 22)).toMatchObject({ method: "POST", pathTemplate: "/", query: ["api-key"], authScheme: "apikey", bodyEncoding: "json", bodySource: "literal" });
    expect(at(r, "Balances.kt", 22).body).toEqual({
      type: "object",
      properties: { method: { type: "string", enum: ["getBalance"] }, params: { type: "array", items: { type: "string", hint: "address" } } },
      required: ["method", "params"],
    });
    expect(at(r, "Messages.kt", 20)).toMatchObject({ provider: "mailgun", method: "POST", bodyEncoding: "form", body: { properties: { to: { type: "string" }, text: { type: "string" } } } });
    expect(at(r, "Messages.kt", 25)).toMatchObject({ bodyEncoding: "multipart", body: { properties: { upload_preset: { enum: ["avatars"] } } } });
    expect(at(r, "Messages.kt", 35)).toMatchObject({ provider: "unsplash", pathTemplate: "/search/photos", query: ["query"], via: "wrapper:Messages.execute" });
    expect(at(r, "Messages.kt", 41)).toMatchObject({ method: "DELETE", headers: ["accept"], via: "wrapper:Messages.execute" });
  });

  it("applies the headers and query parameters of a client's interceptors to its calls", async () => {
    const r = await scanFixture("kotlin/okhttp");
    expect(at(r, "Interceptors.kt", 30)).toMatchObject({ query: ["city", "apikey"], authScheme: "apikey", clientParts: [{ where: "query", name: "apikey", from: "interceptor" }] });
    expect(at(r, "Interceptors.kt", 30).queryShape).toMatchObject({ properties: { apikey: { type: "string", hint: "WEATHER_KEY", env: "WEATHER_KEY" } } });
    expect(at(r, "Interceptors.kt", 37)).toMatchObject({ provider: "github", headers: ["authorization"], authScheme: "bearer", clientParts: [{ where: "header", name: "authorization", from: "interceptor" }] });
    // a client built from another one keeps its interceptors and adds its own
    expect(at(r, "Interceptors.kt", 44)).toMatchObject({ method: "PUT", headers: ["authorization", "x-github-api-version"], headerValues: { "x-github-api-version": "2022-11-28" } });
    expect(at(r, "Balances.kt", 22).clientParts).toBeUndefined();
  });
});

describe("kotlin: java.net.http and HttpURLConnection", () => {
  it("reads HttpRequest builders sent by send / sendAsync and connections configured in the same function", async () => {
    const r = await scanFixture("kotlin/java-http");
    expect(r).toMatchSnapshot();
    expect(r.calls.map((c) => [c.location.line, c.client, c.method, c.pathTemplate])).toEqual([
      [16, "java-http", "POST", "/v1/items"],
      [25, "java-http", "GET", "/incidents"],
      [32, "java-http", "PUT", "/incidents/{id}"],
      [38, "java-http", "POST", "/v2/enqueue"],
      [47, "java-http", "GET", "/v1/status"],
    ]);
    expect(at(r, "Notifier.kt", 16)).toMatchObject({ query: ["limit"], headers: ["authorization"], authScheme: "bearer", bodyEncoding: "json" });
    expect(at(r, "Notifier.kt", 25)).toMatchObject({ headers: ["accept", "authorization"], headerValues: { accept: "application/json" }, authScheme: "apikey" });
    expect(at(r, "Notifier.kt", 38)).toMatchObject({ headers: ["content-type"], bodyEncoding: "json", body: { type: "string" } });
  });
});

describe("kotlin: Ktor client", () => {
  it("reads verbs with their builder lambdas and the client's defaultRequest", async () => {
    const r = await scanFixture("kotlin/ktor");
    expect(r).toMatchSnapshot();
    expect(at(r, "Catalog.kt", 22)).toMatchObject({ client: "ktor", method: "GET", query: ["limit"], headers: ["authorization"], authScheme: "bearer" });
    expect(at(r, "Catalog.kt", 28)).toMatchObject({ method: "POST", bodyEncoding: "json", bodySource: "type", body: { fromType: "NewItem", required: ["name"] } });
    expect(at(r, "Catalog.kt", 30)).toMatchObject({ host: "api.example-catalog.com", pathTemplate: "/v1/categories", query: ["page_size"] });
    const notion = { provider: "notion", clientParts: [{ where: "header", name: "notion-version", from: "default" }], headerValues: { "notion-version": "2022-06-28" } };
    expect(at(r, "Catalog.kt", 48)).toMatchObject({ ...notion, pathTemplate: "/v1/pages/{id}", authScheme: "bearer" });
    expect(at(r, "Catalog.kt", 50)).toMatchObject({ ...notion, method: "POST", pathTemplate: "/v1/search", bodyEncoding: "json", body: { properties: { query: { type: "string" } } } });
    expect(at(r, "Catalog.kt", 56)).toMatchObject({ ...notion, method: "DELETE", pathTemplate: "/v1/blocks/{id}" });
  });
});

describe("kotlin: Spring RestTemplate, RestClient and WebClient", () => {
  it("reads RestTemplate calls with HttpEntity headers, URI builders, and fluent chains with their client's base URL", async () => {
    const r = await scanFixture("kotlin/spring");
    expect(r).toMatchSnapshot();
    expect(at(r, "Payments.kt", 17)).toMatchObject({ client: "spring-rest", method: "GET", pathTemplate: "/v1/items/{id}" });
    expect(at(r, "Payments.kt", 23)).toMatchObject({ method: "POST", headers: ["authorization", "content-type"], headerValues: { "content-type": "application/json" }, authScheme: "bearer", body: { fromType: "Item" } });
    expect(at(r, "Payments.kt", 29)).toMatchObject({ provider: "stripe", bodyEncoding: "form", body: { properties: { charge: { type: "string" } } } });
    expect(at(r, "Payments.kt", 37)).toMatchObject({ urlTemplate: "https://api.example-shop.com/v1/search", query: ["q"] });
    expect(at(r, "Payments.kt", 40)).toMatchObject({ client: "spring-rest", query: ["limit"] });
    expect(at(r, "Payments.kt", 49)).toMatchObject({ client: "spring-webclient", provider: "stripe", pathTemplate: "/v1/charges", authScheme: "bearer", clientParts: [{ where: "header", name: "authorization", from: "default" }] });
    expect(at(r, "Payments.kt", 51)).toMatchObject({ method: "POST", pathTemplate: "/v1/charges/{id}/capture", query: ["expand"], bodyEncoding: "form" });
    expect(at(r, "Payments.kt", 61)).toMatchObject({ provider: "api.example-shop.com", pathTemplate: "/v1/status", authScheme: "basic" });
  });
});

describe("kotlin: OpenFeign", () => {
  it("reports each mapped method of a Feign interface at its declaration", async () => {
    const r = await scanFixture("kotlin/feign");
    expect(r).toMatchSnapshot();
    expect(r.calls.map((c) => [c.location.line, c.client, c.method, c.pathTemplate])).toEqual([
      [23, "feign", "GET", "/v2/orders/{id}"],
      [26, "feign", "POST", "/v2/orders"],
      [29, "feign", "DELETE", "/v2/orders/{id}"],
      [32, "feign", "GET", "/v2/orders"],
      [38, "feign", "GET", "/repos/{owner}/{repo}/issues"],
      [41, "feign", "POST", "/repos/{owner}/{repo}/issues"],
    ]);
    expect(at(r, "Clients.kt", 23)).toMatchObject({ hostKind: "env", envName: "orders.url", host: "api.example-orders.com" });
    expect(at(r, "Clients.kt", 26)).toMatchObject({ query: ["dryRun"], headers: ["idempotency-key"], bodySource: "type", body: { fromType: "Order" } });
    expect(at(r, "Clients.kt", 32)).toMatchObject({ query: ["status", "page"] });
    expect(at(r, "Clients.kt", 38)).toMatchObject({ provider: "github", query: ["state"], headerValues: { accept: "application/json" } });
    expect(at(r, "Clients.kt", 41)).toMatchObject({ headers: ["accept", "content-type"], body: { type: "string" } });
  });
});
