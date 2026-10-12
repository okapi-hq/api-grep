import { describe, expect, it } from "vitest";
import { addHeader, type HeadersResult } from "../../src/resolve/header-names.js";
import { resolveHeaders } from "../../src/resolve/headers.js";
import type { Part } from "../../src/types.js";
import { exprOf } from "../helpers.js";

describe("resolveHeaders", () => {
  it("keeps names only and detects bearer auth from a literal head", () => {
    const r = resolveHeaders(exprOf("const t = 'x'; const h = { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' };", "h"));
    expect(r).toEqual({ names: ["authorization", "content-type"], values: { authorization: null, "content-type": "application/json" }, authScheme: "bearer", known: true });
  });

  it("detects api keys and basic auth", () => {
    expect(resolveHeaders(exprOf("const h = { 'X-API-Key': 'k' };", "h")).authScheme).toBe("apikey");
    expect(resolveHeaders(exprOf("const h = { authorization: 'Basic abc' };", "h")).authScheme).toBe("basic");
    expect(resolveHeaders(exprOf("const h = new Headers({ Authorization: 'Bearer x' });", "h")).authScheme).toBe("bearer");
  });

  it("reports unknown when the object cannot be seen", () => {
    expect(resolveHeaders(exprOf("declare function mk(): Record<string, string>; const h = mk();", "h"))).toMatchObject({ authScheme: "unknown", known: false });
  });
});

describe("addHeader with a parameter's values (#39)", () => {
  const out = (): HeadersResult => ({ names: [], values: {}, authScheme: "none", known: true });
  const lit = (text: string): Part[] => [{ kind: "static", text }];

  it("keeps the first value and lists every literal one when there are several", () => {
    const r = out();
    addHeader(r, "X-Api-Version", lit("2024-06-01"), [lit("2024-06-01"), lit("2025-01-15"), lit("2024-06-01")]);
    expect(r).toMatchObject({ values: { "x-api-version": "2024-06-01" }, alternatives: { "x-api-version": ["2024-06-01", "2025-01-15"] } });
  });

  it("gives null with the literal values when one cannot be read, and no list for a single value", () => {
    const r = out();
    addHeader(r, "X-Api-Version", lit("2024-06-01"), [lit("2024-06-01"), undefined]);
    addHeader(r, "X-Region", lit("eu"), [lit("eu")]);
    expect(r.values).toEqual({ "x-api-version": null, "x-region": "eu" });
    expect(r.alternatives).toEqual({ "x-api-version": ["2024-06-01"] });
  });

  it("never lists credential values", () => {
    const r = out();
    addHeader(r, "Authorization", lit("Bearer a"), [lit("Bearer a"), lit("Bearer b")]);
    expect(r).toMatchObject({ values: { authorization: null }, authScheme: "bearer" });
    expect(r.alternatives).toBeUndefined();
  });
});
