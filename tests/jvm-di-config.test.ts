import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("JVM DI: configuration properties and more injection forms (#94)", () => {
  it("reads Spring @ConfigurationProperties as configuration values with the class's defaults (Kotlin)", async () => {
    const r = await scanFixture("kotlin/di-config");
    expect(r).toMatchSnapshot();
    expect(at(r, "Weather.kt", 26)).toMatchObject({ host: "api.weather-example.com", hostKind: "env", envName: "weather.base-url", headers: ["x-api-key"] });
    expect(at(r, "Weather.kt", 33)).toMatchObject({ urlTemplate: "{env:weather.base-url}/v1/alerts" });
    // a class Spring does not bind keeps its host unknown, not its default
    expect(at(r, "Weather.kt", 43)).toMatchObject({ provider: "unknown", hostKind: "unknown" });
  });

  it("reads getters, records and @DefaultValue (Java)", async () => {
    const r = await scanFixture("java/di-config");
    expect(at(r, "Clients.java", 29)).toMatchObject({ urlTemplate: "{env:payments.base-url}/v1/charges", host: "api.payments-example.com", headers: ["x-merchant"] });
    expect(at(r, "Clients.java", 43)).toMatchObject({ envName: "shipping.carrier.rates-url", host: "rates.shipping-example.com", pathTemplate: "/v2/rates" });
  });

  it("follows interceptors added through Koin getAll, a builder extension, a loop and a method reference", async () => {
    const kt = await scanFixture("kotlin/di-interceptors");
    expect(kt).toMatchSnapshot();
    const both = ["x-parcel-key", "accept-language"];
    expect(at(kt, "Repositories.kt", 7).headers).toEqual(both);
    expect(at(kt, "Repositories.kt", 11).headers).toEqual(both);
    // two clients without a qualifier: neither is attached
    expect(at(kt, "Repositories.kt", 15).headers).toEqual([]);
    const java = await scanFixture("java/di-interceptors");
    expect(java).toMatchSnapshot();
    for (const line of [26, 30, 34]) expect(at(java, "Ledger.java", line).clientParts).toEqual([
      { where: "header", name: "x-tenant", from: "interceptor" },
      { where: "header", name: "x-trace", from: "interceptor" },
    ]);
    // a loop variable reassigned in the loop, to a bean two classes provide: no guess
    expect(at(java, "Ledger.java", 38).headers).toEqual([]);
  });
});
