import { describe, expect, it } from "vitest";
import type { Call } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

const keys = (c: Call): string[] => Object.keys((c.body as { properties?: object } | undefined)?.properties ?? {}).sort();
const base = { provider: "mercadopago", host: "api.mercadopago.com", authScheme: "bearer" };

describe("Mercado Pago (PHP)", () => {
  it("mercadopago/dx-php: 3.x clients, 2.x active records", async () => {
    const r = await scanFixture("php/sdk/mercadopago");
    expect(at(r, "Checkout.php", 24)).toMatchObject({ ...base, method: "POST", pathTemplate: "/checkout/preferences", sdk: { package: "mercadopago/dx-php", chain: "Client.Preference.PreferenceClient.create" } });
    expect(keys(at(r, "Checkout.php", 24))).toEqual(["back_urls", "external_reference", "items"]);
    // the RequestOptions after the request are not body
    expect(keys(at(r, "Checkout.php", 37))).toEqual(["installments", "payer", "token", "transaction_amount"]);
    expect(at(r, "Checkout.php", 47)).toMatchObject({ method: "GET", pathTemplate: "/v1/payments/{id}" });
    expect(at(r, "Checkout.php", 53)).toMatchObject({ method: "PUT", pathTemplate: "/v1/payments/{id}" });
    // an MPSearchRequest's filters are not read
    expect(at(r, "Checkout.php", 54)).toMatchObject({ method: "GET", pathTemplate: "/v1/payments/search", query: [] });
    // bodies the SDK builds from positional arguments
    expect(at(r, "Checkout.php", 60)).toMatchObject({ method: "POST", pathTemplate: "/v1/payments/{payment_id}/refunds" });
    expect(keys(at(r, "Checkout.php", 60))).toEqual(["amount"]);
    expect(keys(at(r, "Checkout.php", 67))).toEqual(["email"]);
    expect(at(r, "Checkout.php", 73)).toMatchObject({ method: "POST", pathTemplate: "/v1/orders/{id}/capture" });
    // 2.x: the attributes set on the record before save() / update()
    expect(at(r, "Legacy.php", 15)).toMatchObject({ method: "POST", pathTemplate: "/checkout/preferences", sdk: { chain: "Preference.save" } });
    expect(keys(at(r, "Legacy.php", 15))).toEqual(["external_reference", "items"]);
    expect(at(r, "Legacy.php", 21)).toMatchObject({ method: "GET", pathTemplate: "/v1/payments/{id}" });
    expect(at(r, "Legacy.php", 23)).toMatchObject({ method: "PUT", pathTemplate: "/v1/payments/{id}" });
    expect(keys(at(r, "Legacy.php", 23))).toEqual(["status"]);
    expect(at(r, "Legacy.php", 24)).toMatchObject({ method: "GET", pathTemplate: "/v1/payments/search", query: ["status"] });
    expect(r.calls).toHaveLength(13);
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["mercadopago/dx-php", "ok"]]);
  });
});

describe("Mercado Pago (npm)", () => {
  it("mercadopago (npm): 2.x classes given the config, the 1.x module", async () => {
    const r = await scanFixture("sdk/mercadopago");
    expect(at(r, "checkout.ts", 8)).toMatchObject({ ...base, method: "POST", pathTemplate: "/checkout/preferences", sdk: { package: "mercadopago", chain: "Preference.create" } });
    expect(keys(at(r, "checkout.ts", 8))).toEqual(["back_urls", "items"]);
    expect(keys(at(r, "checkout.ts", 13))).toEqual(["installments", "payer", "token", "transaction_amount"]);
    expect(at(r, "checkout.ts", 15)).toMatchObject({ method: "GET", pathTemplate: "/v1/payments/{id}" });
    expect(at(r, "checkout.ts", 17)).toMatchObject({ method: "GET", pathTemplate: "/v1/payments/search", query: ["status", "limit"] });
    expect(at(r, "checkout.ts", 19)).toMatchObject({ method: "PUT", pathTemplate: "/v1/payments/{id}" });
    expect(at(r, "checkout.ts", 21)).toMatchObject({ method: "POST", pathTemplate: "/v1/payments/{payment_id}/refunds" });
    expect(keys(at(r, "checkout.ts", 21))).toEqual(["amount"]);
    expect(at(r, "checkout.ts", 23)).toMatchObject({ method: "PUT", pathTemplate: "/v1/customers/{id}" });
    expect(keys(at(r, "checkout.ts", 23))).toEqual(["phone"]);
    expect(at(r, "checkout.ts", 25)).toMatchObject({ method: "POST", pathTemplate: "/preapproval" });
    expect(at(r, "legacy.js", 6)).toMatchObject({ method: "POST", pathTemplate: "/checkout/preferences", sdk: { chain: "preferences.create" } });
    expect(at(r, "legacy.js", 12)).toMatchObject({ method: "GET", pathTemplate: "/v1/payments/search", query: ["status"] });
    // 1.x takes a POST / PUT path id from the payload and leaves it out of the body
    expect(at(r, "legacy.js", 14)).toMatchObject({ method: "PUT", pathTemplate: "/checkout/preferences/{id}" });
    expect(keys(at(r, "legacy.js", 14))).toEqual(["expires"]);
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["mercadopago", "ok"]]);
  });
});

describe("Mercado Pago (Python)", () => {
  it("mercadopago (PyPI): resource factories of the SDK object", async () => {
    const r = await scanFixture("python/sdk/mercadopago");
    expect(at(r, "payments.py", 15)).toMatchObject({ ...base, method: "POST", pathTemplate: "/checkout/preferences", sdk: { package: "mercadopago", chain: "preference.create" } });
    expect(keys(at(r, "payments.py", 15))).toEqual(["auto_return", "back_urls", "items"]);
    expect(keys(at(r, "payments.py", 23))).toEqual(["installments", "payer", "token", "transaction_amount"]);
    expect(at(r, "payments.py", 27)).toMatchObject({ method: "GET", pathTemplate: "/v1/payments/{id}" });
    expect(at(r, "payments.py", 31)).toMatchObject({ method: "GET", pathTemplate: "/v1/payments/search", query: ["status", "limit"] });
    expect(at(r, "payments.py", 35)).toMatchObject({ method: "POST", pathTemplate: "/v1/payments/{payment_id}/refunds" });
    expect(keys(at(r, "payments.py", 35))).toEqual(["amount"]);
    expect(at(r, "payments.py", 41)).toMatchObject({ method: "GET", pathTemplate: "/v1/customers/search", query: ["email"] });
    expect(at(r, "payments.py", 49)).toMatchObject({ method: "POST", pathTemplate: "/v1/orders/{id}/capture" });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["mercadopago", "ok"]]);
  });
});
