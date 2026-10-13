import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assembleCall, callId, type ResolvedCall } from "../../src/assemble.js";
import type { Operation } from "../../src/report/schema.js";
import { onePerRequest } from "../../src/scan.js";

const loc = { file: "src/rpc.ts", line: 4, col: 3, language: "typescript" as const };

const resolved = (operation?: Operation): ResolvedCall => ({
  location: loc,
  client: "fetch",
  url: { hostKind: "literal", host: "api.mainnet-beta.solana.com", scheme: "https", pathTemplate: "/", query: [], queryShape: {}, dynamic: [], raw: "https://api.mainnet-beta.solana.com/" },
  method: "POST",
  dynamic: [],
  body: { encoding: "json", dynamic: [], fromLiteral: true, shape: { type: "object", properties: {}, required: [] } },
  headers: { names: [], values: {}, authScheme: "none" },
  query: { names: [], shape: {} },
  operation,
});

const rpc = (name: string | null, extra: Partial<Operation> = {}): Operation => ({ protocol: "json-rpc", name, dynamic: name === null, from: "body", ...extra });

describe("operation on a call", () => {
  it("is reported as the front end resolved it", () => {
    const op = rpc("getTransaction");
    expect(assembleCall(resolved(op)).operation).toEqual(op);
    expect(assembleCall(resolved()).operation).toBeUndefined();
  });

  it("two operations from one place are two ids", () => {
    const a = assembleCall(resolved(rpc("getTransaction")));
    const b = assembleCall(resolved(rpc("getBalance")));
    expect(a.id).not.toBe(b.id);
    expect(a.id).toBe(callId(loc, 0, "getTransaction"));
  });

  it("a call without an operation name keeps the id of its place", () => {
    const place = createHash("sha1").update("src/rpc.ts:4:3").digest("hex").slice(0, 12);
    expect(assembleCall(resolved()).id).toBe(place);
    expect(assembleCall(resolved(rpc(null))).id).toBe(place);
    expect(callId(loc, 1)).toBe(createHash("sha1").update("src/rpc.ts:4:3#1").digest("hex").slice(0, 12));
  });

  it("only the name counts: alternatives and the protocol's details do not change the id", () => {
    const plain = assembleCall(resolved(rpc("getBlock")));
    const branch = assembleCall(resolved(rpc("getBlock", { alternatives: ["getBlock", "getBlockHeight"] })));
    expect(branch.id).toBe(plain.id);
  });
});

describe("one call per request, with operations", () => {
  it("keeps each operation of a batch, and the same operation twice once", () => {
    const batch = (name: string) => assembleCall(resolved(rpc(name, { batch: true })));
    const calls = onePerRequest([batch("getBalance"), batch("getSlot"), batch("getBalance")]);
    expect(calls.map((c) => c.operation?.name)).toEqual(["getBalance", "getSlot"]);
    expect(calls.map((c) => c.id)).toEqual([callId(loc, 0, "getBalance"), callId(loc, 0, "getSlot")]);
  });

  it("another request with the same operation from one place keeps the name in its id", () => {
    const first = assembleCall(resolved(rpc("getBalance")));
    const second = { ...first, headers: ["x-retry"] };
    const calls = onePerRequest([first, second]);
    expect(calls.map((c) => c.id)).toEqual([callId(loc, 0, "getBalance"), callId(loc, 1, "getBalance")]);
  });

  it("a request without an operation keeps its index among every request from its place, a batch counted once", () => {
    const plain = (event: string) => ({ ...assembleCall(resolved()), headers: [event] });
    const batch = (name: string) => assembleCall(resolved(rpc(name, { batch: true })));
    const calls = onePerRequest([plain("x-before"), { ...assembleCall(resolved(rpc("getHealth"))), headers: ["x-single"] }, batch("getBalance"), batch("getSlot"), plain("x-after")]);
    expect(calls.map((c) => c.id)).toEqual([callId(loc), callId(loc, 0, "getHealth"), callId(loc, 0, "getBalance"), callId(loc, 0, "getSlot"), callId(loc, 3)]);
  });
});
