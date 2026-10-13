import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("JVM: remaining builder forms (#46)", () => {
  it("reads builder steps inside apply { } and client factories with their callers' arguments (OkHttp)", async () => {
    const r = await scanFixture("kotlin/okhttp");
    const client = { where: "header", name: "x-notes-client", from: "interceptor" };
    expect(at(r, "Applied.kt", 25)).toMatchObject({ method: "POST", urlTemplate: "https://notes.example.com/v1/notes", headerValues: { accept: "application/json", "x-notes-client": "notes-mobile" }, bodyEncoding: "json", clientParts: [client] });
    // `b.apply { ... }` on a variable
    expect(at(r, "Applied.kt", 39)).toMatchObject({ method: "PATCH", pathTemplate: "/v1/notes/{id}/archive" });
    // the client's own builder in apply { }
    expect(at(r, "Applied.kt", 47)).toMatchObject({ headerValues: { "x-trace": "on" }, clientParts: [{ where: "header", name: "x-trace", from: "interceptor" }] });
    // `JSONObject().apply { put(k, v) }`
    expect(at(r, "Applied.kt", 55)).toMatchObject({ bodyEncoding: "json", body: { properties: { tag: { type: "string" }, pinned: { enum: [true] } } } });
  });

  it("reads Ktor forms, multipart and kotlinx JSON bodies, url.takeFrom and the Auth plugin", async () => {
    const r = await scanFixture("kotlin/ktor");
    const bearer = { headers: ["authorization"], authScheme: "bearer", clientParts: [{ where: "header", name: "authorization", from: "default" }] };
    expect(at(r, "Forms.kt", 38)).toMatchObject({ ...bearer, method: "POST", pathTemplate: "/oauth/token", bodyEncoding: "form", body: { properties: { grant_type: { enum: ["password"] }, username: { type: "string" } } } });
    expect(at(r, "Forms.kt", 47)).toMatchObject({ urlTemplate: "https://accounts.example-forms.com/api/profile", bodyEncoding: "form", body: { properties: { display_name: { type: "string" } } } });
    expect(at(r, "Forms.kt", 51)).toMatchObject({ bodyEncoding: "multipart", body: { required: ["caption", "image"] } });
    expect(at(r, "Forms.kt", 58)).toMatchObject({ bodyEncoding: "json", body: { properties: { theme: { type: "string" }, notifications: { properties: { email: { type: "boolean" } } } } } });
    expect(at(r, "Forms.kt", 79)).toMatchObject({ authScheme: "basic", headers: ["authorization"] });
  });

  it("reads RestTemplate interceptors, RequestEntity, WebClient default header lambdas, filters and form inserters", async () => {
    const r = await scanFixture("java/spring");
    const partner = { headerValues: { "x-partner": "shop-web" }, clientParts: [{ where: "header", name: "x-partner", from: "interceptor" }] };
    expect(at(r, "Builders.java", 40)).toMatchObject({ ...partner, urlTemplate: "https://partners.example-shop.com/v1/partners/{id}" });
    expect(at(r, "Builders.java", 49)).toMatchObject({ ...partner, method: "POST", pathTemplate: "/v1/partners", headers: ["x-trace", "x-partner"], body: { fromType: "Item" } });
    expect(at(r, "Builders.java", 67)).toMatchObject({ headerValues: { "x-ledger-client": "shop" } });
    expect(at(r, "Builders.java", 80)).toMatchObject({ authScheme: "basic", headerValues: { "x-shop-region": "eu" }, bodyEncoding: "form", body: { required: ["grant_type", "scope"] } });
  });

  it("reads the same Spring forms in Kotlin: interceptors added in apply { }, RequestEntity.method, defaultHeaders { }", async () => {
    const r = await scanFixture("kotlin/spring");
    const warehouse = { headerValues: { "x-warehouse": "north" }, clientParts: [{ where: "header", name: "x-warehouse", from: "interceptor" }] };
    expect(at(r, "Builders.kt", 18)).toMatchObject(warehouse);
    expect(at(r, "Builders.kt", 24)).toMatchObject({ ...warehouse, method: "PUT", pathTemplate: "/v1/reservations/{sku}", headers: ["x-request-source", "x-warehouse"] });
    expect(at(r, "Builders.kt", 32)).toMatchObject({ authScheme: "bearer", clientParts: [{ where: "header", name: "authorization", from: "default" }] });
  });

  it("reads an HttpURLConnection configured and written by helpers it is passed to", async () => {
    const r = await scanFixture("kotlin/java-http");
    expect(at(r, "Helpers.kt", 9)).toMatchObject({ method: "PUT", headerValues: { "content-type": "application/json" }, bodyEncoding: "json" });
  });
});
