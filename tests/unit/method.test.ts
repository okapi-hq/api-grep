import { describe, expect, it } from "vitest";
import { resolveMethod } from "../../src/resolve/method.js";
import { exprOf, sourceOf } from "../helpers.js";

const unknownMethod = { method: "DYNAMIC", dynamic: { where: "method", name: "method", origin: "unknown" } };

describe("resolveMethod", () => {
  it("uses the implied method, upper-cased, over the expression", () => {
    expect(resolveMethod("post", undefined)).toEqual({ method: "POST" });
    expect(resolveMethod("delete", exprOf("const m = 'put';", "m"))).toEqual({ method: "DELETE" });
  });

  it("defaults to GET without an expression or with an empty literal", () => {
    expect(resolveMethod(undefined, undefined)).toEqual({ method: "GET" });
    expect(resolveMethod(undefined, exprOf("const m = '';", "m"))).toEqual({ method: "GET" });
    expect(resolveMethod(undefined, exprOf("const m = '   ';", "m"))).toEqual({ method: "GET" });
  });

  it("upper-cases and trims literal methods", () => {
    expect(resolveMethod(undefined, exprOf("const m = 'post';", "m"))).toEqual({ method: "POST" });
    expect(resolveMethod(undefined, exprOf("const m = ' patch ';", "m"))).toEqual({ method: "PATCH" });
    expect(resolveMethod(undefined, exprOf("const M = 'propfind'; const m = M;", "m"))).toEqual({ method: "PROPFIND" });
    expect(resolveMethod(undefined, exprOf("const m = 'm-search';", "m"))).toEqual({ method: "M-SEARCH" });
  });

  it("does not report a literal that is not a method token", () => {
    expect(resolveMethod(undefined, exprOf("const m = 'GET;rm -rf';", "m"))).toEqual(unknownMethod);
    expect(resolveMethod(undefined, exprOf("const m = 'GET\\nX';", "m"))).toEqual(unknownMethod);
    expect(resolveMethod(undefined, exprOf("const m = 'GET /admin HTTP/1.1';", "m"))).toEqual(unknownMethod);
  });

  it("marks a parameter as dynamic with a param origin", () => {
    const fn = sourceOf("function f(verb: string) { const m = verb; return m; }").getFunctionOrThrow("f");
    const r = resolveMethod(undefined, fn.getVariableDeclarationOrThrow("m").getInitializerOrThrow());
    expect(r).toEqual({ method: "DYNAMIC", dynamic: { where: "method", name: "verb", origin: "param" } });
  });

  it("marks an env var as dynamic with an env origin", () => {
    expect(resolveMethod(undefined, exprOf("const m = process.env.HTTP_METHOD;", "m"))).toEqual({ method: "DYNAMIC", dynamic: { where: "method", name: "HTTP_METHOD", origin: "env" } });
  });
});
