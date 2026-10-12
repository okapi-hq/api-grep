import { describe, expect, it } from "vitest";
import { assembleCalls, type ResolvedCall } from "../../src/assemble.js";
import { graphqlOperations } from "../../src/operation/graphql.js";
import { stringShapeOf } from "../../src/resolve/string-template.js";
import type { Shape } from "../../src/types.js";

const str = (...values: string[]): Shape => ({ type: "string", ...(values.length ? { enum: values } : {}) });
const obj = (properties: Record<string, Shape>): Shape => ({ type: "object", properties, required: Object.keys(properties) });
const persisted = obj({ persistedQuery: obj({ version: { type: "integer", enum: [1] }, sha256Hash: str("abc") }) });

function request(body: Shape | undefined, over: Partial<ResolvedCall> = {}, path = "/graphql"): ResolvedCall {
  return {
    location: { file: "api.ts", line: 3, col: 1, language: "typescript" },
    client: "fetch",
    url: { hostKind: "literal", host: "api.example.com", scheme: "https", pathTemplate: path, query: [], queryShape: {}, dynamic: [], raw: `https://api.example.com${path}` },
    method: "POST",
    dynamic: [],
    body: { shape: body, encoding: body ? "json" : "none", dynamic: [], fromLiteral: true },
    headers: { names: [], values: {}, authScheme: "none" },
    query: { names: [], shape: {} },
    ...over,
  };
}

describe("graphqlOperations: JSON bodies", () => {
  it("reads the document of `query`", () => {
    expect(graphqlOperations(request(obj({ query: str("query Me { me { id } }") })))).toEqual([
      { protocol: "graphql", name: "Me", type: "query", fields: ["me.id"], dynamic: false, from: "document" },
    ]);
  });

  it("operationName picks one operation of several; without it, each is a call", () => {
    const doc = str("query A { a } query B { b }");
    expect(graphqlOperations(request(obj({ query: doc, operationName: str("B") }))).map((o) => o.name)).toEqual(["B"]);
    expect(graphqlOperations(request(obj({ query: doc }))).map((o) => o.name)).toEqual(["A", "B"]);
    // a name the document does not hold is still the name the request sends
    expect(graphqlOperations(request(obj({ query: doc, operationName: str("C") })))).toEqual([{ protocol: "graphql", name: "C", dynamic: false, from: "body" }]);
  });

  it("a document built with computed parts is named by its header", () => {
    const doc = stringShapeOf([
      { kind: "static", text: "mutation Rename { rename(id: " },
      { kind: "dynamic", name: "id", origin: "param" },
      { kind: "static", text: ") { id } }" },
    ]);
    expect(graphqlOperations(request(obj({ query: doc })))).toEqual([{ protocol: "graphql", name: "Rename", type: "mutation", dynamic: false, from: "document" }]);
  });

  it("a document the scan cannot read is GraphQL when the rest of the envelope says so", () => {
    const unknown: Shape = { type: "dynamic", origin: "param", hint: "query" };
    expect(graphqlOperations(request(obj({ query: unknown, variables: obj({}) }), {}, "/v1"))).toEqual([{ protocol: "graphql", name: null, dynamic: true, from: "body" }]);
    expect(graphqlOperations(request(obj({ query: unknown, operationName: str("Feed") }), {}, "/v1"))[0]).toMatchObject({ name: "Feed", dynamic: false });
    expect(graphqlOperations(request(obj({ query: unknown })))).toHaveLength(1);
    expect(graphqlOperations(request(obj({ query: unknown }), {}, "/search"))).toEqual([]);
  });

  it("is not GraphQL: a search text, a search DSL, a JSON-RPC body", () => {
    expect(graphqlOperations(request(obj({ query: str("red shoes") }), {}, "/search"))).toEqual([]);
    expect(graphqlOperations(request(obj({ query: obj({ match: obj({ title: str("x") }) }) }), {}, "/_search"))).toEqual([]);
    expect(graphqlOperations(request(obj({ query: obj({ match: str("x") }) })))).toEqual([]);
    expect(graphqlOperations(request(obj({ jsonrpc: str("2.0"), method: str("getSlot") })))).toEqual([]);
  });

  it("a persisted query: the name from operationName, or none", () => {
    expect(graphqlOperations(request(obj({ operationName: str("GetCart"), extensions: persisted })))).toEqual([{ protocol: "graphql", name: "GetCart", dynamic: false, from: "body" }]);
    expect(graphqlOperations(request(obj({ extensions: persisted })))).toEqual([{ protocol: "graphql", name: null, dynamic: true, from: "body" }]);
  });

  it("a batch: one operation per distinct document", () => {
    const items: Shape = { type: "union", anyOf: [obj({ query: str("query A { a }") }), obj({ query: str("query B { b }") }), obj({ query: str("query A { a }") })] };
    expect(graphqlOperations(request({ type: "array", items })).map((o) => [o.name, o.batch])).toEqual([
      ["A", true],
      ["B", true],
    ]);
  });

  it("a raw body sent as application/graphql", () => {
    const r = request(str("query Ping { ping }"), { headers: { names: ["content-type"], values: { "content-type": "application/graphql" }, authScheme: "none" } });
    expect(graphqlOperations({ ...r, body: { ...r.body, encoding: "raw" } })[0]).toMatchObject({ name: "Ping" });
  });
});

describe("graphqlOperations: URLs and SDK documents", () => {
  it("reads `?query=` from the URL, not a lone placeholder", () => {
    const url = (raw: string): Partial<ResolvedCall> => ({
      method: "GET",
      url: { hostKind: "literal", host: "api.example.com", pathTemplate: "/graphql", query: ["query"], queryShape: { query: str() }, dynamic: [], raw },
    });
    expect(graphqlOperations(request(undefined, url("https://api.example.com/graphql?query=query%20Hours%20%7B%20hours%20%7D")))[0]).toMatchObject({ name: "Hours", fields: ["hours"] });
    expect(graphqlOperations(request(undefined, url("https://api.example.com/graphql?query={q}")))).toEqual([{ protocol: "graphql", name: null, dynamic: true, from: "query" }]);
  });

  it("an SDK method's document, as text or as an object with `query`", () => {
    const sdk = (document: Shape) => request(obj({ owner: str() }), { client: "sdk", document });
    expect(graphqlOperations(sdk(str("{ viewer { login } }")))).toEqual([{ protocol: "graphql", name: "viewer", type: "query", fields: ["viewer.login"], dynamic: false, from: "document" }]);
    expect(graphqlOperations(sdk(obj({ query: str("query R { rateLimit { remaining } }") })))[0]).toMatchObject({ name: "R" });
    // an SDK call without a document is not read for one
    expect(graphqlOperations(request(obj({ query: str("query A { a }") }), { client: "sdk" }))).toEqual([]);
  });

  it("each operation is a call with its own id", () => {
    const calls = assembleCalls(request(obj({ query: str("query A { a } query B { b }") })));
    expect(calls.map((c) => c.operation?.name)).toEqual(["A", "B"]);
    expect(calls[0]!.id).not.toBe(calls[1]!.id);
  });
});
