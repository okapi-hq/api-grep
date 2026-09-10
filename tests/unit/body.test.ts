import { describe, expect, it } from "vitest";
import { resolveBody } from "../../src/resolve/body.js";
import { exprOf, sourceOf } from "../helpers.js";

describe("resolveBody", () => {
  it("shapes object literals with enums for literal values", () => {
    const r = resolveBody(exprOf('const b = JSON.stringify({ amount: 100, currency: "usd", ok: true, tags: ["a", "b"], n: null });', "b"));
    expect(r.encoding).toBe("json");
    expect(r.fromLiteral).toBe(true);
    expect(r.shape).toEqual({
      type: "object",
      properties: {
        amount: { type: "integer", enum: [100] },
        currency: { type: "string", enum: ["usd"] },
        ok: { type: "boolean", enum: [true] },
        tags: { type: "array", items: { type: "string", enum: ["a", "b"] } },
        n: { type: "null" },
      },
      required: ["amount", "currency", "ok", "tags", "n"],
    });
  });

  it("merges spreads and flags computed keys", () => {
    const r = resolveBody(exprOf('const base = { a: 1 }; const k = "x"; const b = { ...base, [k]: 2, c: "s" };', "b"));
    expect(r.shape).toMatchObject({ type: "object", dynamicKeys: true, required: ["a", "c"] });
  });

  it("uses declared types for non-literal values and records the type name", () => {
    const sf = sourceOf('interface In { name: string; age?: number; role: "a" | "b"; nested: { x: number | null } } declare const input: In; const b = JSON.stringify(input);');
    const r = resolveBody(sf.getVariableDeclarationOrThrow("b").getInitializerOrThrow());
    expect(r.fromType).toBe("In");
    expect(r.shape).toMatchObject({
      type: "object",
      required: ["name", "role", "nested"],
      properties: { role: { type: "string", enum: ["a", "b"] }, nested: { type: "object", properties: { x: { type: "union" } } } },
    });
  });

  it("degrades any to dynamic and marks the whole body dynamic", () => {
    const sf = sourceOf("function f(x: any) { const b = JSON.stringify(x); return b; }");
    const r = resolveBody(sf.getFunctionOrThrow("f").getVariableDeclarationOrThrow("b").getInitializerOrThrow());
    expect(r.shape).toEqual({ type: "dynamic", origin: "param", hint: "x" });
    expect(r.dynamic).toEqual([{ where: "body", name: "body", origin: "param" }]);
  });

});

describe("resolveBody encodings", () => {
  it("detects form and multipart encodings and appended keys", () => {
    const form = resolveBody(exprOf("const b = new URLSearchParams({ grant_type: 'x' });", "b"));
    expect(form).toMatchObject({ encoding: "form", shape: { type: "object", properties: { grant_type: { type: "string", enum: ["x"] } } } });
    const sf = sourceOf('const fd = new FormData(); fd.append("file", new Blob()); fd.append("purpose", "x"); const b = fd;');
    const multi = resolveBody(sf.getVariableDeclarationOrThrow("b").getInitializerOrThrow());
    expect(multi).toMatchObject({ encoding: "multipart", shape: { type: "object", required: ["file", "purpose"] } });
  });

  it("parses JSON string bodies and keeps raw strings raw", () => {
    expect(resolveBody(exprOf(`const b = '{"a": 1}';`, "b"))).toMatchObject({ encoding: "json", shape: { type: "object", properties: { a: { type: "integer", enum: [1] } } } });
    expect(resolveBody(exprOf(`const b = "plain text";`, "b"))).toMatchObject({ encoding: "raw", shape: { type: "string" } });
  });

  it("guards against recursive types", () => {
    const sf = sourceOf("interface Tree { value: number; children: Tree[] } declare const t: Tree; const b = t;");
    const r = resolveBody(sf.getVariableDeclarationOrThrow("b").getInitializerOrThrow());
    expect(r.shape?.type).toBe("object");
  });
});
