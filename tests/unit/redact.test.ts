import { describe, expect, it } from "vitest";
import { looksSecret, redact } from "../../src/report/redact.js";

describe("redact", () => {
  it("recognizes common secret shapes", () => {
    expect(looksSecret("sk_live_51ABCDEFghijklmnop")).toBe(true);
    expect(looksSecret("AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(looksSecret("ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toBe(true);
    expect(looksSecret("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U")).toBe(true);
    expect(looksSecret("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(looksSecret("/v1/customers/{id}")).toBe(false);
    expect(looksSecret("api.stripe.com")).toBe(false);
  });

  it("walks nested values and counts replacements", () => {
    const { value, count } = redact({ a: ["sk_live_51ABCDEFghijklmnop", "ok"], b: { c: "AKIAIOSFODNN7EXAMPLE" } });
    expect(count).toBe(2);
    expect(value).toEqual({ a: ["<redacted>", "ok"], b: { c: "<redacted>" } });
  });
});
