import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

const fromInterceptor = (names: string[]): { where: string; name: string; from: string }[] => names.map((name) => ({ where: "header", name, from: "interceptor" }));

describe("JVM DI: wrapped interceptors, lists built in steps, handed builders (#100)", () => {
  it("follows interceptors wrapped by a project extension, lists built with buildList and add (Kotlin)", async () => {
    const r = await scanFixture("kotlin/di-wrapped");
    expect(r).toMatchSnapshot();
    expect(at(r, "Stations.kt", 11)).toMatchObject({ headers: ["user-agent", "x-radio-region"], headerValues: { "user-agent": "RadioApp/2.1", "x-radio-region": "eu-west" } });
    expect(at(r, "Stations.kt", 15).clientParts).toEqual(fromInterceptor(["user-agent"]));
    // a local function of the provider adds the token; the header set on the response is not the request's
    expect(at(r, "Stations.kt", 19)).toMatchObject({ headers: ["user-agent", "authorization"], authScheme: "bearer" });
    // two lists fit the unqualified injection: neither is attached
    expect(at(r, "MirrorModules.kt", 35).headers).toEqual([]);
  });

  it("follows a Java static helper given the builder, a filled ArrayList and a delegating interceptor class", async () => {
    const r = await scanFixture("java/di-wrapped");
    expect(r).toMatchSnapshot();
    expect(at(r, "Places.java", 20).clientParts).toEqual(fromInterceptor(["x-atlas-key", "accept-language"]));
    // two Interceptor beans and nothing selecting one
    expect(at(r, "Places.java", 24).headers).toEqual([]);
  });
});

describe("JVM DI: nested configuration properties and configuration files (#100)", () => {
  it("reads nested groups, a @Bean binding and application.yml values (Kotlin)", async () => {
    const r = await scanFixture("kotlin/di-config-files", { exclude: [] });
    expect(r).toMatchSnapshot();
    const file = "src/main/kotlin/com/example/catalog/Catalog.kt";
    expect(at(r, file, 51)).toMatchObject({ urlTemplate: "{env:catalog.api.base-url}/v3/products", host: "eu.catalog-example.com", headers: ["x-region"] });
    expect(at(r, file, 53)).toMatchObject({ envName: "INVENTORY_URL", host: "inventory.example.com", pathTemplate: "/v1/stock/{sku}" });
    // bound under two prefixes: no value is taken
    expect(at(r, file, 55)).toMatchObject({ provider: "unknown", hostKind: "unknown" });
  });

  it("reads nested getters and application.properties (Java)", async () => {
    const r = await scanFixture("java/di-config-files", { exclude: [] });
    const file = "src/main/java/com/example/billing/Invoices.java";
    expect(at(r, file, 46)).toMatchObject({ envName: "billing.gateway.base-url", host: "eu.gateway.billing-example.com", headers: ["x-merchant"] });
    expect(at(r, file, 50)).toMatchObject({ envName: "LEDGER_URL", host: "ledger.billing-example.com", pathTemplate: "/v1/entries" });
  });
});
