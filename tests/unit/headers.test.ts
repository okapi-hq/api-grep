import { describe, expect, it } from "vitest";
import { resolveHeaders } from "../../src/resolve/headers.js";
import { exprOf } from "../helpers.js";

describe("resolveHeaders", () => {
  it("keeps names only and detects bearer auth from a literal head", () => {
    const r = resolveHeaders(exprOf("const t = 'x'; const h = { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' };", "h"));
    expect(r).toEqual({ names: ["authorization", "content-type"], authScheme: "bearer", known: true });
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
