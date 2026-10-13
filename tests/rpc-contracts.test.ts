import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

const rpc = (name: string, extra: object = {}): object => ({ protocol: "json-rpc", name, dynamic: false, from: "body", ...extra });

describe("contract objects of JSON-RPC client libraries (#78)", () => {
  it("ethers: the runner's endpoint; a view, a transaction signed by the app or by the node, as the ABI and the runner say", async () => {
    const r = await scanFixture("rpc-contracts/ethers");
    expect(at(r, "vault.ts", 15)).toMatchObject({
      client: "sdk",
      sdk: { package: "ethers", chain: "Contract.balanceOf" },
      provider: "infura",
      method: "POST",
      urlTemplate: "https://mainnet.infura.io/v3/{env:INFURA_KEY}",
      operation: rpc("eth_call"),
    });
    expect(at(r, "vault.ts", 19).operation).toEqual(rpc("eth_sendRawTransaction"));
    expect(at(r, "vault.ts", 23)).toMatchObject({ sdk: { chain: "Contract.transfer.estimateGas" }, operation: rpc("eth_estimateGas") });
    expect(at(r, "vault.ts", 27).operation).toEqual(rpc("eth_call"));
    // an ABI the code does not write out: either
    expect(at(r, "vault.ts", 32).operation).toEqual(rpc("eth_call", { alternatives: ["eth_call", "eth_sendRawTransaction"] }));
    expect(at(r, "vault.ts", 37).operation).toEqual(rpc("eth_sendTransaction"));
    expect(at(r, "vault.ts", 41).operation).toEqual(rpc("eth_getLogs"));
    // the contract's own members (`interface`, `getAddress`) send nothing
    expect(r.calls.map((c) => c.location.line)).toEqual([15, 19, 23, 27, 32, 37, 41]);
  });

  it("web3.js and viem: the call says what it sends, through the client the contract was built with", async () => {
    const r = await scanFixture("rpc-contracts/web3-viem");
    expect(at(r, "registry.ts", 11)).toMatchObject({ sdk: { package: "web3", chain: "methods.balanceOf.call" }, provider: "eth.example-node.io", operation: rpc("eth_call") });
    expect(at(r, "registry.ts", 15).operation).toEqual(rpc("eth_sendTransaction", { alternatives: ["eth_sendTransaction", "eth_sendRawTransaction"] }));
    expect(at(r, "registry.ts", 24)).toMatchObject({ sdk: { package: "viem", chain: "getContract.read.balanceOf" }, provider: "alchemy", operation: rpc("eth_call") });
    expect(at(r, "registry.ts", 28)).toMatchObject({ provider: "rpc.example-chain.net", operation: { name: "eth_sendRawTransaction" } });
    expect(at(r, "registry.ts", 32)).toMatchObject({ provider: "alchemy", operation: rpc("eth_call") });
  });

  it("a contract on a wallet, on no runner, or a transaction through a provider alone sends nothing over HTTP", async () => {
    const r = await scanFixture("rpc-contracts/wallets");
    expect(r.calls).toEqual([]);
  });

  it("web3.py: contract functions, events and properties that send a request", async () => {
    const r = await scanFixture("python/rpc-contracts");
    expect(at(r, "vault.py", 14)).toMatchObject({ sdk: { package: "web3", chain: "eth.contract.functions.balanceOf.call" }, provider: "eth.example-node.io", operation: rpc("eth_call") });
    const pay = r.calls.filter((c) => c.location.line === 18).map((c) => c.operation?.name);
    expect(pay.sort()).toEqual(["eth_accounts", "eth_sendTransaction"]);
    expect(at(r, "vault.py", 30).operation).toEqual(rpc("eth_getLogs"));
    expect(at(r, "vault.py", 34)).toMatchObject({ sdk: { chain: "eth.block_number" }, operation: rpc("eth_blockNumber") });
    expect(at(r, "vault.py", 38)).toMatchObject({ provider: "infura", operation: rpc("eth_chainId") });
    // a socket client's property, and a bound method handed over, are no HTTP request
    expect(r.calls.some((c) => c.location.line >= 47)).toBe(false);
  });
});

describe("node vendors and helpers taking a client (#78)", () => {
  it("ethers vendor providers: the host the library builds from the network, the vendor's domain when it cannot be read", async () => {
    const r = await scanFixture("rpc-contracts/vendors");
    expect(at(r, "feeds.ts", 12)).toMatchObject({ provider: "infura", urlTemplate: "https://sepolia.infura.io/v3/{projectId}", operation: rpc("eth_blockNumber") });
    expect(at(r, "feeds.ts", 13).urlTemplate).toBe("https://eth-mainnet.alchemyapi.io/v2/{apiKey}");
    expect(at(r, "feeds.ts", 14).urlTemplate).toBe("https://ethers.base-mainnet.quiknode.pro/{token}");
    expect(at(r, "feeds.ts", 15).urlTemplate).toBe("https://mainnet.infura.io/v3/{projectId}");
    // a network name spreads requests over several vendors; a URL is a JsonRpcProvider
    expect(at(r, "feeds.ts", 16)).toMatchObject({ provider: "unknown", hostKind: "unknown" });
    expect(at(r, "feeds.ts", 17).provider).toBe("eth.example-node.io");
    expect(at(r, "feeds.ts", 18)).toMatchObject({ provider: "alchemy", urlTemplate: "https://{network}.g.alchemy.com/v2/{apiKey}" });
    expect(at(r, "feeds.ts", 23)).toMatchObject({ provider: "alchemy", operation: rpc("eth_call") });
    expect(r.calls.some((c) => c.location.line === 27)).toBe(false);
  });

  it("@solana/spl-token helpers: the connection handed in, the RPC method they send", async () => {
    const r = await scanFixture("rpc-contracts/spl-token");
    expect(at(r, "payouts.ts", 8)).toMatchObject({ sdk: { package: "@solana/spl-token", chain: "getAccount" }, provider: "helius", operation: rpc("getAccountInfo") });
    expect(at(r, "payouts.ts", 13)).toMatchObject({ provider: "helius", operation: rpc("getAccountInfo") });
    expect(at(r, "payouts.ts", 17).operation).toEqual(rpc("sendTransaction"));
    expect(r.calls).toHaveLength(3);
  });
});
