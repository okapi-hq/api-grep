import { Node } from "ts-morph";
import { describe, expect, it } from "vitest";
import { getProp, propertyKey } from "../../src/ast/object.js";
import { isSafeKey } from "../../src/record-keys.js";
import { exprOf } from "../helpers.js";

function keysOf(code: string): (string | undefined)[] {
  const o = exprOf(code, "o");
  if (!Node.isObjectLiteralExpression(o)) throw new Error("not an object literal");
  return o.getProperties().map((m) => propertyKey(m));
}

describe("propertyKey", () => {
  it("reads identifier, string, numeric, computed and method keys", () => {
    expect(keysOf("const a = 1; const o = { id: 1, 'x-y': 2, 10: 3, ['lit']: 4, [`tpl`]: 5, run() {}, a };")).toEqual(["id", "x-y", "10", "lit", "tpl", "run", "a"]);
  });

  it("reads non-literal computed keys and spreads as unknown", () => {
    expect(keysOf("const k = 'x'; const b = {}; const o = { [k]: 1, ...b };")).toEqual([undefined, undefined]);
  });

  it.each([
    ["identifier", "__proto__: 1"],
    ["string", "'__proto__': 1"],
    ["computed", "['__proto__']: 1"],
    ["template", "[`__proto__`]: 1"],
  ])("reads a %s __proto__ key as unknown", (_form, member) => {
    expect(keysOf(`const o = { ${member} };`)).toEqual([undefined]);
  });

  it.each([
    ["identifier", "constructor: 1"],
    ["string", "'constructor': 1"],
    ["computed", "['constructor']: 1"],
    ["method", "constructor() {}"],
  ])("reads a %s constructor key as unknown", (_form, member) => {
    expect(keysOf(`const o = { ${member} };`)).toEqual([undefined]);
  });
});

describe("getProp", () => {
  it("finds plain and shorthand properties", () => {
    expect(getProp(exprOf("const o = { method: 'POST' };", "o"), "method")?.getText()).toBe("'POST'");
    expect(getProp(exprOf("const method = 'PUT'; const o = { method };", "o"), "method")?.getText()).toBe("method");
  });

  it("follows spreads and const identifiers", () => {
    const o = exprOf("const base = { headers: { a: 1 } }; const mid = { ...base }; const o = { ...mid, body: 'x' };", "o");
    expect(getProp(o, "headers")?.getText()).toBe("{ a: 1 }");
    expect(getProp(o, "body")?.getText()).toBe("'x'");
    expect(getProp(o, "missing")).toBeUndefined();
  });

  it("never finds __proto__ or constructor members", () => {
    const o = exprOf("const o = { __proto__: { a: 1 }, ['constructor']: 2 };", "o");
    expect(getProp(o, "__proto__")).toBeUndefined();
    expect(getProp(o, "constructor")).toBeUndefined();
  });

  it("returns undefined for what is not an object literal", () => {
    expect(getProp(exprOf("declare function mk(): { a: 1 }; const o = mk();", "o"), "a")).toBeUndefined();
    expect(getProp(undefined, "a")).toBeUndefined();
  });

  it("lets a later member override an earlier spread, as JavaScript does", () => {
    const o = exprOf("const defaults = { method: 'GET' }; const o = { ...defaults, method: 'POST' };", "o");
    expect(getProp(o, "method")?.getText()).toBe("'POST'");
  });
});

describe("isSafeKey", () => {
  it("rejects keys a report record cannot hold", () => {
    expect(isSafeKey("__proto__")).toBe(false);
    expect(isSafeKey("constructor")).toBe(false);
  });

  it("accepts every other key", () => {
    for (const k of ["", "id", "prototype", "toString", "__proto", "Constructor"]) expect(isSafeKey(k), k).toBe(true);
  });
});
