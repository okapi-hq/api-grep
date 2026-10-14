import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

const header = (name: string) => ({ where: "header", name, from: "interceptor" });

describe("JVM DI: Lazy and Provider, multibindings, bindings by other types, Injekt (#75)", () => {
  it("reads `Lazy<T>` / `Provider<T>` injection points and a Retrofit call factory (Kotlin)", async () => {
    const r = await scanFixture("kotlin/di-lazy");
    expect(r).toMatchSnapshot();
    // `callFactory { request -> client.get().newCall(request) }` is the client, not a request of its own
    expect(r.calls.filter((c) => c.location.file === "NetworkModule.kt")).toHaveLength(0);
    expect(at(r, "Notes.kt", 13)).toMatchObject({ client: "retrofit", authScheme: "bearer", clientParts: [header("authorization")] });
    expect(at(r, "Notes.kt", 18)).toMatchObject({ authScheme: "bearer", clientParts: [header("authorization")] });
    expect(at(r, "Notes.kt", 22)).toMatchObject({ authScheme: "bearer" });
    // no qualifier and two flavors' clients: nothing is attached
    expect(at(r, "Notes.kt", 27)).toMatchObject({ headers: [] });
  });

  it("applies the interceptors of an injected multibinding set", async () => {
    const r = await scanFixture("kotlin/di-multibind");
    expect(r).toMatchSnapshot();
    expect(at(r, "Weather.kt", 19)).toMatchObject({ headers: ["x-api-key", "x-app-version"], headerValues: { "x-app-version": "4.2.0" } });
    expect(at(r, "Weather.kt", 23)).toMatchObject({ headers: ["x-maps-key"] });
    // a whole set and a contribution under one name: neither is applied
    expect(at(r, "Weather.kt", 27)).toMatchObject({ headers: [] });
  });

  it("follows Koin `bind`, options and type qualifiers", async () => {
    const r = await scanFixture("kotlin/di-koin-bind");
    expect(r).toMatchSnapshot();
    expect(at(r, "Repositories.kt", 10)).toMatchObject({ headers: ["x-radio-key"], clientParts: [header("x-radio-key")] });
    expect(at(r, "Repositories.kt", 14)).toMatchObject({ urlTemplate: "https://uploads.radio-example.com/v2/status" });
    expect(at(r, "Repositories.kt", 26)).toMatchObject({ headers: ["x-archive-token"] });
    // two definitions bound to the type under one qualifier
    expect(at(r, "Repositories.kt", 30)).toMatchObject({ headers: [] });
  });

  it("follows Injekt definitions and lookups", async () => {
    const r = await scanFixture("kotlin/di-injekt");
    expect(r).toMatchSnapshot();
    expect(at(r, "Sources.kt", 14)).toMatchObject({ headers: ["user-agent"] });
    expect(at(r, "Sources.kt", 20)).toMatchObject({ urlTemplate: "https://api.comics-example.com/v3/series/{id}" });
  });

  it("gives Spring beans by the interfaces they implement and as a List (Java)", async () => {
    const r = await scanFixture("java/di-spring-types");
    expect(r).toMatchSnapshot();
    expect(at(r, "Services.java", 21)).toMatchObject({ headers: ["x-api-key", "x-trace-source"] });
    // two beans implement the interface: the single injection point gets neither
    expect(at(r, "Services.java", 25)).toMatchObject({ headers: [] });
    expect(at(r, "Services.java", 29)).toMatchObject({ client: "spring-webclient", headers: ["x-tenant"] });
  });

  it("reads Dagger `Lazy` / `Provider` and a multibinding set in Java", async () => {
    const r = await scanFixture("java/di-lazy");
    expect(r).toMatchSnapshot();
    expect(at(r, "Meters.java", 14)).toMatchObject({ client: "retrofit", headers: ["x-zone"] });
    expect(at(r, "Meters.java", 27)).toMatchObject({ client: "okhttp", headers: ["x-zone"] });
  });
});
