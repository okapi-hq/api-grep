import { describe, expect, it } from "vitest";
import { resolveProvider } from "../../src/normalize/provider.js";

describe("resolveProvider with a raw host", () => {
  it.each(["constructor", "__proto__", "a b", "x/y", "evil\nhost", "host;rm", "a@b.com"])("never makes %j the provider", (host) => {
    expect(resolveProvider({ hostKind: "literal", host })).toEqual({ provider: "unknown" });
  });

  it.each(["api.example.com", "billing:8080", "my_service:3000", "API-1.Example.io"])("names the provider after %j", (host) => {
    expect(resolveProvider({ hostKind: "literal", host })).toEqual({ provider: host });
  });

  it("falls back to the env var name when the host is unsafe", () => {
    expect(resolveProvider({ hostKind: "env", host: "constructor", envName: "BILLING_URL" })).toEqual({ provider: "env:BILLING_URL" });
  });
});
