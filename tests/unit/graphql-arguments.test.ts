import { describe, expect, it } from "vitest";
import { MAX_ARGUMENT_CHARS, MAX_ARGUMENTS } from "../../src/operation/graphql-arguments.js";
import { documentOperations } from "../../src/operation/graphql-document.js";
import { documentTemplate } from "../../src/operation/graphql-template.js";
import { stringShapeOf } from "../../src/resolve/string-template.js";
import type { Part } from "../../src/types.js";

const only = (text: string) => documentOperations(text)![0]!;
const dynamic = (name: string): Part => ({ kind: "dynamic", name, origin: "param" });
const text = (t: string): Part => ({ kind: "static", text: t });

describe("GraphQL: the literal arguments of selected fields (#56)", () => {
  it("keeps literals as JSON values and variables as $name, by path", () => {
    const op = only('query Q($n: Int) { shop { orders(first: $n, sortKey: CREATED_AT, query: "open", big: 12345678901234567890, f: 1.5) { id } } }');
    expect(op.arguments).toEqual({ "shop.orders": { first: "$n", sortKey: "CREATED_AT", query: "open", big: "12345678901234567890", f: 1.5 } });
  });

  it("reads a fragment's arguments where it is spread, and omits arguments when no field has any", () => {
    const op = only("{ a { ...F } b { ...F } } fragment F on T { photo(size: 64) { url } }");
    expect(op.arguments).toEqual({ "a.photo": { size: 64 }, "b.photo": { size: 64 } });
    expect(only("{ a { b } }")).not.toHaveProperty("arguments");
  });

  it("redacts strings and numbers under credential names, not enum values", () => {
    const op = only('mutation { login(password: "x", pin: 1234, input: { secretKey: "y", user: "u" }, sortKey: NAME) { ok } }');
    expect(op.arguments).toEqual({ login: { password: "<redacted>", pin: 1234, input: { secretKey: "<redacted>", user: "u" }, sortKey: "NAME" } });
  });

  it("drops keys a report record cannot hold", () => {
    const op = only("{ constructor(a: 1) { id } item(__proto__: 1, constructor: 2, id: 3) { id } }");
    expect(op.arguments).toEqual({ item: { id: 3 } });
  });

  it("leaves the arguments out past a bound, the fields kept", () => {
    const many = only(`{ ${Array.from({ length: MAX_ARGUMENTS + 1 }, (_, i) => `f${i}: item(id: ${i}) { id }`).join(" ")} }`);
    expect(many.fields).toEqual(["item.id"]);
    expect(many).not.toHaveProperty("arguments");
    const long = only(`{ item(note: "${"a".repeat(MAX_ARGUMENT_CHARS)}") { id } }`);
    expect(long.fields).toEqual(["item.id"]);
    expect(long).not.toHaveProperty("arguments");
    const deep = only(`{ item(tree: ${"[".repeat(20)}1${"]".repeat(20)}) { id } }`);
    expect(deep).not.toHaveProperty("arguments");
    expect(only(`{ item(tree: ${"[".repeat(10)}1${"]".repeat(10)}) { id } }`).arguments).toBeDefined();
  });
});

describe("GraphQL: documents with computed parts (#56)", () => {
  it("writes a part inside a string as {name}, and leaves one outside out", () => {
    const shape = stringShapeOf([text('query Q { user(id: "'), dynamic("id"), text('") { name } list(first: '), dynamic("n"), text(") { id } }")]);
    expect(documentTemplate(shape)).toBe('query Q { user(id: "{id}") { name } list(first: ) { id } }');
  });

  it("follows block strings, escapes and comments", () => {
    const parts = [text('query Q { a(t: """x \\""" '), dynamic("b"), text('""") { id } # "\n c(t: "\\" '), dynamic("d"), text('") { id } }')];
    expect(documentTemplate(stringShapeOf(parts))).toBe('query Q { a(t: """x \\""" {b}""") { id } # "\n c(t: "\\" {d}") { id } }');
    const comment = stringShapeOf([text('query Q { # say "hi\n a('), dynamic("x"), text(") { id } }")]);
    expect(documentTemplate(comment)).toBe('query Q { # say "hi\n a() { id } }');
  });

  it("leaves a computed operation name unread", () => {
    expect(documentTemplate(stringShapeOf([text("query Get"), dynamic("kind"), text(" { a }")]))).toBeUndefined();
  });
});
