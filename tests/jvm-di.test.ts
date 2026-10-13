import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

const authorization = { where: "header", name: "authorization", from: "interceptor" };

describe("JVM: clients a DI container provides (#46)", () => {
  it("follows Hilt / Dagger providers, qualifiers, provided builders and injected interceptors (Kotlin)", async () => {
    const r = await scanFixture("kotlin/di-hilt");
    expect(r).toMatchSnapshot();
    // `@CatalogRetrofit retrofit: Retrofit` -> the provider with that qualifier, built from the provided builder
    expect(at(r, "Apis.kt", 11)).toMatchObject({ urlTemplate: "https://catalog.shelf-example.com/v2/books/{id}", authScheme: "bearer", clientParts: [authorization] });
    expect(at(r, "Apis.kt", 16)).toMatchObject({ urlTemplate: "https://reviews.shelf-example.com/reviews", bodyEncoding: "json" });
    // an `@Inject` constructor's client and its injected interceptor
    expect(at(r, "Repositories.kt", 27)).toMatchObject({ client: "okhttp", headers: ["authorization"], authScheme: "bearer", clientParts: [authorization] });
    // `@Named("uploads")`: the client built from the provided one keeps its interceptor and adds its own
    expect(at(r, "Repositories.kt", 32)).toMatchObject({ headers: ["authorization", "x-upload-channel"], headerValues: { "x-upload-channel": "mobile" } });
    // `@Inject lateinit var client: OkHttpClient`
    expect(at(r, "Repositories.kt", 45)).toMatchObject({ authScheme: "bearer", clientParts: [authorization] });
  });

  it("follows Koin definitions, constructions with get(), singleOf and by inject()", async () => {
    const r = await scanFixture("kotlin/di-koin");
    expect(r).toMatchSnapshot();
    const tracks = { host: "api.tracks-example.com", headerValues: { "x-client": "android" }, clientParts: [{ where: "header", name: "x-client", from: "default" }] };
    expect(at(r, "Repositories.kt", 14)).toMatchObject({ ...tracks, urlTemplate: "https://api.tracks-example.com/v1/tracks" });
    expect(at(r, "Repositories.kt", 19)).toMatchObject({ ...tracks, method: "POST" });
    // `get(named("uploads"))`: the named definition
    expect(at(r, "Repositories.kt", 24)).toMatchObject({ headers: ["x-upload-key"], clientParts: [{ where: "header", name: "x-upload-key", from: "interceptor" }] });
    expect(at(r, "Repositories.kt", 31)).toMatchObject(tracks);
  });

  it("attaches nothing when several providers fit, or the class is also built by hand", async () => {
    const r = await scanFixture("kotlin/di-ambiguous");
    expect(r).toMatchSnapshot();
    expect(r.calls).toHaveLength(4);
    // two flavors provide the client: neither interceptor is listed
    expect(at(r, "Repositories.kt", 11)).toMatchObject({ headers: [] });
    expect(at(r, "Repositories.kt", 11).clientParts).toBeUndefined();
    // two named clients, an unnamed injection point: no base URL
    expect(at(r, "Repositories.kt", 15)).toMatchObject({ urlTemplate: "v2/tiles" });
    expect(at(r, "Repositories.kt", 19)).toMatchObject({ urlTemplate: "https://alerts.weather-example.com/v1/active" });
    expect(at(r, "Repositories.kt", 24).clientParts).toBeUndefined();
  });

  it("follows Spring beans: @Primary, @Qualifier, the bean named like the field, @Value parameters (Java)", async () => {
    const r = await scanFixture("java/di-spring");
    expect(r).toMatchSnapshot();
    expect(at(r, "Services.java", 19)).toMatchObject({ client: "spring-rest", urlTemplate: "https://catalog.orders-example.com/v1/items/{id}" });
    expect(at(r, "Services.java", 33)).toMatchObject({ host: "shipping.orders-example.com", pathTemplate: "/v1/quotes", query: ["zip"] });
    expect(at(r, "Services.java", 44)).toMatchObject({ client: "spring-webclient", host: "billing.orders-example.com", headerValues: { "x-tenant": "orders" } });
    // two WebClient beans, neither primary nor named like the field
    expect(at(r, "Services.java", 55)).toMatchObject({ urlTemplate: "/v1/events", headers: [] });
  });

  it("follows Dagger modules in Java: @Binds, named strings, @Inject constructors", async () => {
    const r = await scanFixture("java/di-dagger");
    expect(r).toMatchSnapshot();
    const key = { headers: ["x-api-key"], authScheme: "apikey", clientParts: [{ where: "header", name: "x-api-key", from: "interceptor" }] };
    expect(at(r, "Net.java", 38)).toMatchObject({ client: "retrofit", urlTemplate: "https://tracking.parcels-example.com/api/parcels/{id}", ...key });
    expect(at(r, "Net.java", 51)).toMatchObject({ client: "okhttp", host: "labels.parcels-example.com", ...key });
  });
});
