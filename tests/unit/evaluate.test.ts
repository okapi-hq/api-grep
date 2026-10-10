import { describe, expect, it } from "vitest";
import { evaluate, partsToTemplate, staticText } from "../../src/resolve/evaluate.js";
import { exprOf, sourceOf, initializerOf } from "../helpers.js";

describe("evaluate", () => {
  it("resolves literals, templates and concatenation", () => {
    expect(staticText(evaluate(exprOf(`const x = "a" + "b";`, "x")))).toBe("ab");
    expect(partsToTemplate(evaluate(exprOf("const id = 1; const x = `/v1/${id}/x`;", "x")))).toBe("/v1/1/x");
  });

  it("names dynamic segments after identifiers, properties and calls", () => {
    const sf = sourceOf("declare const user: { id: string }; declare function getId(): string; function f(p: string) { const x = `/${p}/${user.id}/${getId()}`; return x; }");
    const fn = sf.getFunctionOrThrow("f");
    const x = fn.getVariableDeclarationOrThrow("x").getInitializerOrThrow();
    expect(partsToTemplate(evaluate(x))).toBe("/{p}/{id}/{getId}");
    const parts = evaluate(x).filter((p) => p.kind === "dynamic");
    expect(parts.map((p) => (p.kind === "dynamic" ? p.origin : ""))).toEqual(["param", "unknown", "call"]);
  });

  it("resolves env vars in several syntaxes", () => {
    expect(evaluate(exprOf("const x = process.env.API_URL;", "x"))).toEqual([{ kind: "env", name: "API_URL" }]);
    expect(evaluate(exprOf('const x = process.env["API_URL"];', "x"))).toEqual([{ kind: "env", name: "API_URL" }]);
    expect(evaluate(exprOf("const x = process.env.API_URL ?? 'https://fallback';", "x"))).toEqual([{ kind: "env", name: "API_URL", fallback: "https://fallback" }]);
  });

  it("follows same-file constants and as-const objects", () => {
    const sf = sourceOf('const BASE = "https://api.x.com"; const C = { url: "https://api.y.com" } as const; const a = BASE + "/v1"; const b = C.url + "/v2";');
    expect(staticText(evaluate(initializerOf(sf, "a")))).toBe("https://api.x.com/v1");
    expect(staticText(evaluate(initializerOf(sf, "b")))).toBe("https://api.y.com/v2");
    expect(evaluate(initializerOf(sf, "a"))[0]).toMatchObject({ viaConst: true });
  });

  it("passes through encodeURIComponent and String()", () => {
    const sf = sourceOf("function f(id: string) { const x = `/u/${encodeURIComponent(id)}/${String(id)}`; return x; }");
    const x = sf.getFunctionOrThrow("f").getVariableDeclarationOrThrow("x").getInitializerOrThrow();
    expect(partsToTemplate(evaluate(x))).toBe("/u/{id}/{id}");
  });

  it("handles new URL(path, base)", () => {
    const sf = sourceOf('const B = "https://api.x.com/v1/"; const a = new URL("/users", B); const b = new URL("users", B); const c = new URL("https://other.com/a", B);');
    expect(partsToTemplate(evaluate(initializerOf(sf, "a")))).toBe("https://api.x.com/users");
    expect(partsToTemplate(evaluate(initializerOf(sf, "b")))).toBe("https://api.x.com/v1/users");
    expect(partsToTemplate(evaluate(initializerOf(sf, "c")))).toBe("https://other.com/a");
  });
});

describe("evaluate conditionals", () => {
  it("takes the first branch when both are static, else the one with a literal host, else dynamic", () => {
    const sf = sourceOf(
      'const prod = process.env.NODE_ENV === "production"; const a = prod ? "https://api.x.com" : "https://sandbox.x.com"; declare const h: string; declare const p: string; const b = prod ? h : "https://x.com"; const c = prod ? h : p; const d = p ? ":" + p : "";',
    );
    expect(staticText(evaluate(initializerOf(sf, "a")))).toBe("https://api.x.com");
    expect(staticText(evaluate(initializerOf(sf, "b")))).toBe("https://x.com");
    expect(evaluate(initializerOf(sf, "c"))[0]?.kind).toBe("dynamic");
    expect(staticText(evaluate(initializerOf(sf, "d")))).toBe("");
  });
});
