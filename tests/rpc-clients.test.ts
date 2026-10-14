import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scan } from "../src/scan.js";
import { at, scanFixture } from "./fixture-helpers.js";

const rpc = (name: string, extra: object = {}): object => ({ protocol: "json-rpc", name, dynamic: false, from: "body", ...extra });

describe("JSON-RPC client libraries of Solana nodes (#52)", () => {
  it("@solana/web3.js: the Connection's URL, the method sent rather than the helper called", async () => {
    const r = await scanFixture("rpc-clients/solana");
    expect(at(r, "ledger.ts", 6)).toMatchObject({
      client: "sdk",
      sdk: { package: "@solana/web3.js", chain: "getBalance" },
      provider: "rpc.example-chain.net",
      method: "POST",
      urlTemplate: "https://rpc.example-chain.net",
      operation: rpc("getBalance"),
    });
    // a client helper that sends another RPC method
    expect(at(r, "ledger.ts", 10).operation).toEqual(rpc("getTransaction"));
    // a package function taking the connection, and a typed parameter: the project's one connection
    expect(at(r, "ledger.ts", 18)).toMatchObject({ sdk: { chain: "sendAndConfirmTransaction" }, provider: "rpc.example-chain.net", operation: rpc("sendTransaction") });
    expect(at(r, "ledger.ts", 22)).toMatchObject({ provider: "rpc.example-chain.net", operation: rpc("getSlot") });
    // two methods from one place are two endpoints
    expect(at(r, "ledger.ts", 6).id).not.toBe(at(r, "ledger.ts", 10).id);
  });

  it("@solana/kit: the RPC method called on `createSolanaRpc(url)`, before its `.send()`; `clusterApiUrl` is the cluster's URL", async () => {
    const r = await scanFixture("rpc-clients/solana-kit");
    expect(at(r, "accounts.ts", 6)).toMatchObject({ sdk: { package: "@solana/kit", chain: "getBalance" }, provider: "rpc.example-chain.net", operation: rpc("getBalance") });
    expect(at(r, "accounts.ts", 15)).toMatchObject({ provider: "rpc.example-chain.net", operation: rpc("getAccountInfo") });
    expect(r.calls).toHaveLength(3);
    const c = await scanFixture("rpc-clients/solana-cluster");
    expect(at(c, "faucet.ts", 6)).toMatchObject({ urlTemplate: "https://api.devnet.solana.com", hostKind: "literal", operation: rpc("requestAirdrop") });
    // the public clusters are a provider of their own (#85)
    expect(at(c, "faucet.ts", 10)).toMatchObject({ provider: "solana-public-rpc", host: "api.mainnet-beta.solana.com", operation: rpc("getMinimumBalanceForRentExemption") });
  });

});

describe("JSON-RPC client libraries of EVM nodes (#52)", () => {
  it("viem: the http transport, also in a fallback, `request({ method })` and viem/actions; a wallet transport is not HTTP", async () => {
    const r = await scanFixture("rpc-clients/viem");
    expect(at(r, "chain.ts", 14)).toMatchObject({
      sdk: { package: "viem", chain: "getBalance" },
      urlTemplate: "https://eth.example-node.io/v1/demo",
      body: { type: "object", properties: { blockTag: { type: "string", enum: ["safe"] } } },
      operation: rpc("eth_getBalance"),
    });
    expect(at(r, "chain.ts", 22)).toMatchObject({ provider: "unknown", hostKind: "unknown", operation: rpc("eth_gasPrice") });
    expect(at(r, "chain.ts", 26).operation).toEqual(rpc("eth_chainId"));
    expect(at(r, "chain.ts", 30)).toMatchObject({ provider: "eth.example-node.io", operation: rpc("eth_blockNumber") });
    expect(r.calls.find((c) => c.location.line === 34)).toBeUndefined();
  });

  it("ethers: JsonRpcProvider (v6 and v5), `send(method, params)`, a helper's callers; never a BrowserProvider or a Contract", async () => {
    const r = await scanFixture("rpc-clients/ethers");
    expect(at(r, "node.ts", 8)).toMatchObject({ provider: "env:ETH_NODE_URL", hostKind: "env", operation: rpc("eth_getBalance") });
    expect(at(r, "node.ts", 16)).toMatchObject({ body: { type: "array" }, operation: rpc("eth_feeHistory") });
    expect(at(r, "node.ts", 20).operation).toEqual(rpc("eth_getBlockByNumber", { alternatives: ["eth_getBlockByNumber", "eth_getBlockByHash"] }));
    expect(r.calls.map((c) => c.location.line)).toEqual([8, 12, 16, 20]);
    const h = await scanFixture("rpc-clients/ethers-helpers");
    expect(at(h, "node.ts", 9).operation).toEqual(rpc("eth_blockNumber"));
    expect(at(h, "node.ts", 11).operation).toEqual(rpc("net_peerCount"));
    expect(at(h, "node.ts", 14)).toMatchObject({ provider: "eth.example-node.io", operation: rpc("eth_getCode") });
  });

  it("web3.js: a URL is HTTP, an injected provider is the wallet", async () => {
    const r = await scanFixture("rpc-clients/web3");
    expect(at(r, "node.ts", 7)).toMatchObject({ sdk: { package: "web3", chain: "eth.getBalance" }, provider: "eth.example-node.io", operation: rpc("eth_getBalance") });
    expect(r.calls.map((c) => c.location.line)).toEqual([7, 11, 15]);
  });

  it("a dApp's wallet clients, and typed clients of a project that builds only those, are not reported", async () => {
    const r = await scanFixture("rpc-clients/wallets");
    expect(r.calls).toEqual([]);
    // `key.toString()` on a typed `PublicKey` is no registry method (an inherited key once crashed the call)
    expect(r.diagnostics?.droppedCalls).toEqual([]);
  });
});

describe("JSON-RPC client libraries in Python, and bounds (#52)", () => {
  it("web3.py and solana-py: the provider's URL; a WebSocket provider is not HTTP", async () => {
    const r = await scanFixture("python/rpc-clients");
    expect(at(r, "node.py", 14)).toMatchObject({ sdk: { package: "web3", chain: "eth.get_balance" }, provider: "eth.example-node.io", method: "POST", operation: rpc("eth_getBalance") });
    expect(at(r, "node.py", 22)).toMatchObject({ provider: "env:NODE_URL", operation: rpc("eth_getTransactionCount") });
    expect(at(r, "node.py", 26)).toMatchObject({ body: { type: "array" }, operation: rpc("eth_feeHistory") });
    expect(at(r, "node.py", 43)).toMatchObject({ sdk: { package: "solana", chain: "get_latest_blockhash" }, provider: "rpc.example-chain.net", operation: rpc("getLatestBlockhash") });
    expect(r.calls.find((c) => c.location.line === 30)).toBeUndefined();
  });

  it("a transport that refers to itself, and many clients, end without a guess", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "api-grep-rpc-clients-"));
    try {
      const clients = Array.from({ length: 30 }, (_, i) => `export const c${i} = new JsonRpcProvider("https://n${i}.example.com");`);
      const source = [
        'import { JsonRpcProvider, type Provider } from "ethers";',
        'import { createPublicClient } from "viem";',
        "let a: any = b; let b: any = a;",
        "const looped = createPublicClient({ transport: a });",
        ...clients,
        "export const one = (p: Provider) => p.getBlockNumber();",
        "export const two = () => looped.getBlockNumber();",
      ];
      fs.writeFileSync(path.join(repo, "nodes.ts"), source.join("\n"));
      const r = await scan({ dir: repo });
      expect(r.calls.map((c) => [c.location.line, c.provider, c.operation?.name])).toEqual([[35, "unknown", "eth_blockNumber"]]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
