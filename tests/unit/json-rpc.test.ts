import { describe, expect, it } from "vitest";
import { assembleCalls, type ResolvedCall } from "../../src/assemble.js";
import { jsonRpcOperations } from "../../src/operation/json-rpc.js";
import type { BodyResult } from "../../src/resolve/body.js";
import { stringShapeOf } from "../../src/resolve/string-template.js";
import type { Shape } from "../../src/types.js";

const str = (...values: string[]): Shape => ({ type: "string", ...(values.length ? { enum: values } : {}) });
const obj = (properties: Record<string, Shape>): Shape => ({ type: "object", properties, required: Object.keys(properties) });
const envelope = (method: Shape): Shape => obj({ jsonrpc: str("2.0"), id: { type: "integer", enum: [1] }, method, params: { type: "array", items: { type: "unknown" } } });
const json = (shape: Shape, encoding: BodyResult["encoding"] = "json"): BodyResult => ({ shape, encoding, dynamic: [], fromLiteral: true });

describe("jsonRpcOperations", () => {
  it("reads the method of a request", () => {
    expect(jsonRpcOperations(json(envelope(str("getHealth"))))).toEqual([{ protocol: "json-rpc", name: "getHealth", dynamic: false, from: "body" }]);
  });

  it("a method some branch leaves unknown keeps the known names and is dynamic", () => {
    const method: Shape = { type: "union", anyOf: [str("eth_call"), { type: "dynamic", origin: "param", hint: "method" }] };
    expect(jsonRpcOperations(json(envelope(method)))).toEqual([{ protocol: "json-rpc", name: "eth_call", dynamic: true, from: "body" }]);
  });

  it("a method of a declared type has no name", () => {
    expect(jsonRpcOperations(json(envelope(str())))).toEqual([{ protocol: "json-rpc", name: null, dynamic: true, from: "body" }]);
  });

  it("a computed method keeps its literal parts", () => {
    const method = stringShapeOf([{ kind: "static", text: "eth_" }, { kind: "dynamic", name: "kind", origin: "param" }]);
    expect(jsonRpcOperations(json(envelope(method)))[0]).toMatchObject({ name: "eth_{kind}", dynamic: true });
    // nothing literal: no name
    const opaque = stringShapeOf([{ kind: "dynamic", name: "kind", origin: "param" }]);
    expect(jsonRpcOperations(json(envelope(opaque)))[0]).toMatchObject({ name: null, dynamic: true });
  });

  it("a batch gives one operation per distinct method, even a typed array of requests", () => {
    const items: Shape = { type: "union", anyOf: [envelope(str("a")), envelope(str("b")), envelope(str("a")), str("not a request")] };
    expect(jsonRpcOperations(json({ type: "array", items })).map((o) => [o.name, o.batch])).toEqual([
      ["a", true],
      ["b", true],
    ]);
    expect(jsonRpcOperations(json({ type: "array", items: envelope(str()) }))).toEqual([{ protocol: "json-rpc", name: null, batch: true, dynamic: true, from: "body" }]);
  });

  it("JSON-RPC 1.0: a string method with params and id, unless the method is an HTTP verb", () => {
    const v1 = (method: Shape) => obj({ method, params: { type: "array", items: { type: "unknown" } }, id: str("x") });
    expect(jsonRpcOperations(json(v1(str("getblockcount"))))[0]?.name).toBe("getblockcount");
    expect(jsonRpcOperations(json(v1(str("GET"))))).toEqual([]);
    expect(jsonRpcOperations(json(v1({ type: "integer", enum: [3] })))).toEqual([]);
    expect(jsonRpcOperations(json(obj({ method: str("card"), amount: { type: "number" } })))).toEqual([]);
  });

  it("only JSON bodies", () => {
    expect(jsonRpcOperations(json(envelope(str("getHealth")), "form"))).toEqual([]);
    expect(jsonRpcOperations({ encoding: "none", dynamic: [], fromLiteral: false })).toEqual([]);
  });
});

describe("assembleCalls", () => {
  const resolved = (body: Shape, client: ResolvedCall["client"] = "fetch"): ResolvedCall => ({
    location: { file: "rpc.ts", line: 3, col: 1, language: "typescript" },
    client,
    url: { hostKind: "literal", host: "rpc.example-chain.net", scheme: "https", pathTemplate: "/", query: [], queryShape: {}, dynamic: [], raw: "https://rpc.example-chain.net/" },
    method: "POST",
    dynamic: [],
    body: json(body),
    headers: { names: [], values: {}, authScheme: "none" },
    query: { names: [], shape: {} },
  });

  it("one call per operation of a batch, with its own id", () => {
    const calls = assembleCalls(resolved({ type: "array", items: { type: "union", anyOf: [envelope(str("a")), envelope(str("b"))] } }));
    expect(calls.map((c) => c.operation?.name)).toEqual(["a", "b"]);
    expect(calls[0]!.id).not.toBe(calls[1]!.id);
  });

  it("leaves SDK calls and calls the front end named alone", () => {
    expect(assembleCalls(resolved(envelope(str("a")), "sdk"))[0]!.operation).toBeUndefined();
    const own = { protocol: "json-rpc" as const, name: "x", dynamic: false, from: "body" as const };
    expect(assembleCalls({ ...resolved(envelope(str("a"))), operation: own }).map((c) => c.operation)).toEqual([own]);
  });
});
