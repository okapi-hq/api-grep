import { describe, expect, it } from "vitest";
import { documentHeader, documentOperations, MAX_DOCUMENT_CHARS, MAX_FIELDS, operationDocument } from "../../src/operation/graphql-document.js";

describe("documentOperations", () => {
  it("reads type, name and sorted leaf paths, aliases resolved", () => {
    const ops = documentOperations(`query GetOrder($id: ID!) { order(id: $id) { total: totalPriceSet { shopMoney { amount } } id customer { mail: email } } }`);
    expect(ops).toEqual([
      { type: "query", name: "GetOrder", named: true, fields: ["order.customer.email", "order.id", "order.totalPriceSet.shopMoney.amount"], arguments: { order: { id: "$id" } } },
    ]);
  });

  it("names an anonymous operation by its root fields, sorted", () => {
    expect(documentOperations("{ shop { name } locations { id } }")?.[0]).toMatchObject({ type: "query", name: "locations,shop", named: false });
    expect(documentOperations("mutation { ping }")?.[0]).toMatchObject({ type: "mutation", name: "ping" });
  });

  it("inlines fragment spreads and inline fragments, wherever the fragment is defined in the document", () => {
    const doc = `
      query Feed { feed { ...Post ... on Video { duration } } }
      fragment Post on Item { id author { ...Person } }
      fragment Person on User { name }
    `;
    expect(documentOperations(doc)?.[0]?.fields).toEqual(["feed.author.name", "feed.duration", "feed.id"]);
  });

  it("keeps the field a fragment from elsewhere sits on, and stops at a fragment spread inside itself", () => {
    expect(documentOperations("query A { node { ...Elsewhere } }")?.[0]?.fields).toEqual(["node"]);
    const cycle = "query B { node { ...Loop } } fragment Loop on Node { id child { ...Loop } }";
    expect(documentOperations(cycle)?.[0]?.fields).toEqual(["node.child", "node.id"]);
  });

  it("gives every operation of a document, subscriptions too", () => {
    const ops = documentOperations("query A { a } subscription OnB { b { id } }");
    expect(ops?.map((o) => [o.type, o.name])).toEqual([
      ["query", "A"],
      ["subscription", "OnB"],
    ]);
  });

  it("is not a document: plain text, a fragment alone, JSON", () => {
    expect(documentOperations("red shoes")).toBeUndefined();
    expect(documentOperations("fragment F on T { id }")).toBeUndefined();
    expect(documentOperations('{"a": 1}')).toBeUndefined();
  });
});

describe("documentOperations bounds", () => {
  it("leaves a document past the size bound unparsed", () => {
    const big = `query Big { a ${"b ".repeat(MAX_DOCUMENT_CHARS / 2)} }`;
    expect(documentOperations(big)).toBeUndefined();
    expect(documentHeader(big)).toEqual({ type: "query", name: "Big" });
  });

  it("leaves the fields out when fragments expand past the bounds", () => {
    // each fragment spreads the previous one twice: 2^30 selections if expanded
    const levels = Array.from({ length: 30 }, (_, i) => `fragment F${i + 1} on T { a: x { ...F${i} } b: y { ...F${i} } }`);
    const bomb = `query Bomb { root { ...F30 } } fragment F0 on T { id } ${levels.join(" ")}`;
    const [op] = documentOperations(bomb)!;
    expect(op).toEqual({ type: "query", name: "Bomb", named: true });
  });

  it("leaves the fields out past the number of paths", () => {
    const wide = `query Wide { ${Array.from({ length: MAX_FIELDS + 1 }, (_, i) => `f${i}`).join(" ")} }`;
    expect(documentOperations(wide)?.[0]?.fields).toBeUndefined();
  });

  it("leaves the fields out past the nesting bound", () => {
    const deep = `query Deep ${"{ a ".repeat(40)}${"}".repeat(40)}`;
    expect(documentOperations(deep)?.[0]).toMatchObject({ name: "Deep" });
    expect(documentOperations(deep)?.[0]?.fields).toBeUndefined();
  });
});

describe("documentHeader and operationDocument", () => {
  it("reads the header of a document built with computed parts", () => {
    expect(documentHeader('# a comment\nmutation SetName { setName(id: {id}, name: "x") }')).toEqual({ type: "mutation", name: "SetName" });
    expect(documentHeader("{ viewer { id } }")).toBeUndefined();
  });

  it("keeps one named operation and every fragment", () => {
    const text = "query A { a { ...F } } query B { b } fragment F on T { id }";
    expect(documentOperations(operationDocument(text, "A")!)?.map((o) => o.name)).toEqual(["A"]);
    expect(operationDocument(text, "C")).toBeUndefined();
  });
});
