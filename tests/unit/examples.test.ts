import { describe, expect, it } from "vitest";
import { byName, credentialPlaceholder, looksBoolean } from "../../src/examples/names.js";
import { Rng } from "../../src/examples/random.js";
import { hasAlternatives, hasOptional, synth, type SynthCtx } from "../../src/examples/synth.js";
import { exampleToCurl } from "../../src/report/curl.js";
import type { Shape } from "../../src/types.js";

const ctx = (variant: SynthCtx["variant"] = "minimal", seed = "seed"): SynthCtx => ({ rng: new Rng(seed), variant });

describe("Rng", () => {
  it("is deterministic for a seed and differs across seeds", () => {
    const a = new Rng("x");
    const b = new Rng("x");
    const c = new Rng("y");
    const seqA = [a.int(0, 1000), a.word(), a.uuid()];
    const seqB = [b.int(0, 1000), b.word(), b.uuid()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual([c.int(0, 1000), c.word(), c.uuid()]);
  });
});

describe("byName", () => {
  const rng = new Rng("names");
  it("picks values that fit the key and the requested kind", () => {
    expect(byName("email", "string", rng)).toMatch(/^[a-z]+\.[a-z]+@example\.com$/);
    expect(byName("callbackUrl", "string", rng)).toMatch(/^https:\/\/example\.com\//);
    expect(byName("userId", "number", rng)).toBeTypeOf("number");
    expect(byName("userId", "string", rng)).toMatch(/^[a-z0-9]{8}$/);
    expect(byName("createdAt", "string", rng)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(byName("per_page", "number", rng)).toBeGreaterThanOrEqual(10);
    expect(byName("currency", "string", rng)).toBe("usd");
    expect(byName("unrelated", "string", rng)).toBeUndefined();
    expect(byName("email", "boolean", rng)).toBeUndefined();
  });
  it("never invents credentials", () => {
    expect(credentialPlaceholder("apiKey")).toBe("<apiKey>");
    expect(credentialPlaceholder("client_secret")).toBe("<client_secret>");
    expect(credentialPlaceholder("password")).toBe("<password>");
    expect(credentialPlaceholder("keyboard")).toBeUndefined();
    expect(byName("accessToken", "string", rng)).toBe("<accessToken>");
  });
  it("recognizes boolean-looking keys", () => {
    expect(looksBoolean("isActive")).toBe(true);
    expect(looksBoolean("notifications_enabled")).toBe(true);
    expect(looksBoolean("name")).toBe(false);
  });
});

describe("synth", () => {
  const shape: Shape = {
    type: "object",
    properties: {
      name: { type: "string" },
      role: { type: "string", enum: ["admin", "user"] },
      age: { type: "integer" },
      tags: { type: "array", items: { type: "string" } },
      source: { type: "union", anyOf: [{ type: "object", properties: { kind: { type: "string", enum: ["card"] } }, required: ["kind"] }, { type: "object", properties: { kind: { type: "string", enum: ["bank"] } }, required: ["kind"] }] },
      file: { type: "dynamic", origin: "param", hint: "Buffer" },
      isPublic: { type: "unknown" },
    },
    required: ["name", "role", "source"],
  };

  it("minimal keeps required properties and first enum / union branch", () => {
    const v = synth(shape, "body", ctx("minimal")) as Record<string, unknown>;
    expect(Object.keys(v).sort()).toEqual(["name", "role", "source"]);
    expect(v.role).toBe("admin");
    expect(v.source).toEqual({ kind: "card" });
  });

  it("full adds optional properties, alt switches enum and union branches", () => {
    const full = synth(shape, "body", ctx("full")) as Record<string, unknown>;
    expect(full.age).toBeTypeOf("number");
    expect(full.tags).toHaveLength(2);
    expect(full.file).toBe("<binary>");
    expect(full.isPublic).toBe(true);
    const alt = synth(shape, "body", ctx("alt")) as Record<string, unknown>;
    expect(alt.role).toBe("user");
    expect(alt.source).toEqual({ kind: "bank" });
    expect(alt.isPublic).toBe(false);
  });

  it("is deterministic for a seed", () => {
    expect(synth(shape, "body", ctx("full", "a"))).toEqual(synth(shape, "body", ctx("full", "a")));
  });

  it("reports which variants are worth emitting", () => {
    expect(hasOptional(shape)).toBe(true);
    expect(hasAlternatives(shape)).toBe(true);
    expect(hasOptional({ type: "object", properties: { a: { type: "string" } }, required: ["a"] })).toBe(false);
    expect(hasAlternatives({ type: "object", properties: { a: { type: "string", enum: ["x"] } }, required: ["a"] })).toBe(false);
  });
});

describe("exampleToCurl", () => {
  it("renders json and form bodies", () => {
    const json = exampleToCurl({ variant: "minimal", method: "POST", url: "https://a.example/x?q=1", headers: { "content-type": "application/json" }, query: { q: "1" }, body: { a: "it's" }, bodyEncoding: "json" });
    expect(json).toBe(`curl -X POST 'https://a.example/x?q=1' \\\n  -H 'content-type: application/json' \\\n  --data '{"a":"it'\\''s"}'`);
    const form = exampleToCurl({ variant: "minimal", method: "POST", url: "https://a.example/t", headers: {}, query: {}, body: { grant_type: "password", n: 2 }, bodyEncoding: "form" });
    expect(form).toContain("--data-urlencode 'grant_type=password'");
    expect(form).toContain("--data-urlencode 'n=2'");
  });
});
