import { describe, expect, it } from "vitest";
import { callId } from "../src/assemble.js";
import type { Report } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

const operations = (r: Report, file: string, line: number) => r.calls.filter((c) => c.location.file === file && c.location.line === line).map((c) => c.operation);

describe("JSON-RPC: the method is the call's operation (#34)", () => {
  it("typescript: envelope, helper, batch, branch, computed and 1.0 requests", async () => {
    const r = await scanFixture("json-rpc");
    expect(at(r, "node.ts", 4)).toMatchObject({ method: "POST", pathTemplate: "/", operation: { protocol: "json-rpc", name: "getTransaction", dynamic: false, from: "body" } });
    // each call of the helper with a literal method is its own operation; inside the helper, every method its callers pass
    expect([20, 21, 22].map((line) => at(r, "node.ts", line).operation?.name)).toEqual(["getBalance", "getSlot", "getBlock"]);
    expect(at(r, "node.ts", 12).operation).toEqual({ protocol: "json-rpc", name: "getBalance", alternatives: ["getBalance", "getSlot", "getBlock"], dynamic: false, from: "body" });
    // a batch: one call per method, the same method twice once
    expect(operations(r, "node.ts", 25)).toEqual([
      { protocol: "json-rpc", name: "getBalance", batch: true, dynamic: false, from: "body" },
      { protocol: "json-rpc", name: "getSlot", batch: true, dynamic: false, from: "body" },
    ]);
    expect(at(r, "node.ts", 36).operation).toMatchObject({ name: "getTransaction", alternatives: ["getTransaction", "getSignatureStatuses"], dynamic: false });
    expect(at(r, "node.ts", 43).operation).toMatchObject({ name: "get{kind}Info", dynamic: true });
    expect(at(r, "node.ts", 47).operation).toMatchObject({ name: "getblockcount", dynamic: false });
    expect(at(r, "node.ts", 52).operation).toBeUndefined();
    expect(at(r, "node.ts", 56).operation).toBeUndefined();
  });

  it("two methods sent to one URL are two ids, also from one batch", async () => {
    const r = await scanFixture("json-rpc");
    const rpcCalls = r.calls.filter((c) => c.operation);
    expect(new Set(rpcCalls.map((c) => c.id)).size).toBe(rpcCalls.length);
    expect(new Set(rpcCalls.map((c) => `${c.method} ${c.urlTemplate}`)).size).toBe(2);
    const [a, b] = r.calls.filter((c) => c.location.line === 25);
    expect(a!.body).toEqual(b!.body);
  });

  it("python: json= and json.dumps bodies, helper, batch, branch, concatenated method", async () => {
    const r = await scanFixture("python/json-rpc");
    expect(at(r, "node.py", 9).operation).toEqual({ protocol: "json-rpc", name: "eth_getBalance", dynamic: false, from: "body" });
    expect([17, 21, 25].map((line) => at(r, "node.py", line).operation?.name)).toEqual(["eth_blockNumber", "eth_chainId", "eth_gasPrice"]);
    expect(operations(r, "node.py", 29).map((o) => o?.name)).toEqual(["eth_getBalance", "eth_blockNumber"]);
    expect(at(r, "node.py", 37).operation?.alternatives).toEqual(["eth_getTransactionByHash", "eth_getTransactionReceipt"]);
    expect(at(r, "node.py", 41).operation).toMatchObject({ name: "{namespace}_syncing", dynamic: true });
    expect(at(r, "node.py", 46).operation).toBeUndefined();
  });

  it("php: Guzzle json and json_encode bodies, helper, batch, branch, interpolated method", async () => {
    const r = await scanFixture("php/json-rpc");
    expect(at(r, "NodeClient.php", 18).operation).toEqual({ protocol: "json-rpc", name: "getBlockHeight", dynamic: false, from: "body" });
    expect([28, 33, 38].map((line) => at(r, "NodeClient.php", line).operation?.name)).toEqual(["getSlot", "getSupply", "getHealth"]);
    expect(operations(r, "NodeClient.php", 43).map((o) => o?.name)).toEqual(["getBalance", "getSlot"]);
    expect(at(r, "NodeClient.php", 52).operation?.alternatives).toEqual(["getTransaction", "getSignatureStatuses"]);
    expect(at(r, "NodeClient.php", 57).operation).toMatchObject({ name: "get{kind}Info", dynamic: true });
  });
});

describe("JSON-RPC beside ordinary requests", () => {
  it("ordinary requests a helper sends beside a JSON-RPC one keep their ids", async () => {
    const r = await scanFixture("json-rpc");
    const fromCaller = r.calls.filter((c) => c.location.file === "audited.ts" && c.location.line === 12);
    const loc = fromCaller[0]!.location;
    // before the method was reported, the three requests were the 0th, 1st and 2nd from this place
    expect(fromCaller.map((c) => [c.operation?.name ?? null, c.id])).toEqual([
      [null, callId(loc)],
      ["getHealth", callId(loc, 0, "getHealth")],
      [null, callId(loc, 2)],
    ]);
  });
});
