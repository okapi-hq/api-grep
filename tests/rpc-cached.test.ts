import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

const rpc = (name: string, extra: object = {}): object => ({ protocol: "json-rpc", name, dynamic: false, from: "body", ...extra });

describe("JSON-RPC clients kept in a cache or handed in a context (#85)", () => {
  it("a cache a helper fills: one host when every entry agrees, unknown when they differ, no call when one is a wallet", async () => {
    const r = await scanFixture("rpc-clients/cached");
    expect(at(r, "archive.ts", 17)).toMatchObject({ sdk: { package: "ethers", chain: "getBalance" }, provider: "archive.example-node.io", operation: rpc("eth_getBalance") });
    // `new JsonRpcProvider(RPC_URLS[chainId])`: the URL depends on the key, not the table's first entry
    expect(at(r, "chains.ts", 19)).toMatchObject({ sdk: { chain: "Contract.totalSupply" }, provider: "unknown", operation: rpc("eth_call") });
    expect(at(r, "chains.ts", 24)).toMatchObject({ provider: "unknown", operation: rpc("eth_blockNumber") });
    // a provider class of the app beside a literal URL
    expect(at(r, "proxied.ts", 21)).toMatchObject({ provider: "unknown", operation: rpc("eth_call") });
    expect(at(r, "context.ts", 7)).toMatchObject({ provider: "jobs.example-node.io", operation: rpc("eth_gasPrice") });
    expect(r.calls.some((c) => c.location.file === "sessions.ts")).toBe(false);
  });

  it("useConnection(): the endpoint of the app's <ConnectionProvider>; the wallet's own sendTransaction is not one", async () => {
    const r = await scanFixture("rpc-clients/wallet-adapter");
    expect(at(r, "wallet-panel.tsx", 11)).toMatchObject({
      sdk: { package: "@solana/wallet-adapter-react", chain: "connection.getBalance" },
      provider: "solana.example-node.io",
      urlTemplate: "https://solana.example-node.io/rpc",
      operation: rpc("getBalance"),
    });
    expect(r.calls.map((c) => c.location.line)).toEqual([11, 17, 24]);
  });

  it("the wallet adapter's connection has the methods of @solana/web3.js's Connection", () => {
    const read = (f: string): { methods: Record<string, unknown> } => JSON.parse(readFileSync(path.join("src/detect/registry", f), "utf8")) as { methods: Record<string, unknown> };
    const own = read("solana-web3.json").methods;
    const adapter = read("solana-wallet-adapter.json").methods;
    expect(adapter).toEqual(Object.fromEntries(Object.entries(own).map(([k, v]) => [`connection.${k}`, v])));
  });
});

describe("wagmi (#85)", () => {
  it("hooks and actions send through the config's transport; writes go through the wallet", async () => {
    const r = await scanFixture("rpc-clients/wagmi");
    expect(at(r, "vault.tsx", 12)).toMatchObject({ sdk: { package: "wagmi", chain: "useReadContract" }, provider: "eth.example-node.io", urlTemplate: "https://eth.example-node.io/v1", operation: rpc("eth_call") });
    expect(at(r, "vault.tsx", 20)).toMatchObject({ sdk: { chain: "getLogs" }, operation: rpc("eth_getLogs") });
    expect(at(r, "vault.tsx", 26)).toMatchObject({ sdk: { package: "@wagmi/core", chain: "readContract" }, operation: rpc("eth_call") });
    expect(r.calls.map((c) => c.location.line)).toEqual([12, 13, 16, 20, 26, 30]);
  });

  it("a config with one client per chain leaves the host unknown; a wallet's transport gives no call", async () => {
    const r = await scanFixture("rpc-clients/wagmi-chains");
    expect(r.calls.map((c) => [c.location.line, c.provider, c.operation?.name])).toEqual([
      [6, "unknown", "eth_blockNumber"],
      [7, "unknown", "eth_gasPrice"],
      [13, "unknown", "eth_feeHistory"],
    ]);
    expect((await scanFixture("rpc-clients/wagmi-wallet")).calls).toEqual([]);
  });

  it("hooks use the config the app gives <WagmiProvider>: one built by another library is not read", async () => {
    const r = await scanFixture("rpc-clients/wagmi-provided");
    expect(r.calls.map((c) => [c.location.line, c.provider, c.operation?.name])).toEqual([[22, "reader.example-node.io", "eth_blockNumber"]]);
  });
});

describe("contracts reached in other ways (#85)", () => {
  it("TypeChain factories, connect / attach, contracts typed as parameters, ABIs imported from JSON", async () => {
    const r = await scanFixture("rpc-contracts/typechain");
    expect(at(r, "treasury.ts", 11)).toMatchObject({ sdk: { package: "ethers", chain: "Contract.totalAssets" }, provider: "rpc.example-chain.net", operation: rpc("eth_call") });
    // the factory's ABI says `deposit` writes; the Wallet signs it in the app
    expect(at(r, "treasury.ts", 16).operation).toEqual(rpc("eth_sendRawTransaction"));
    // a factory generated at build time: a provider only reads
    expect(at(r, "treasury.ts", 20).operation).toEqual(rpc("eth_call"));
    // the JSON ABI says `transfer` writes, `connect(signer)` signs it
    expect(at(r, "treasury.ts", 29)).toMatchObject({ sdk: { chain: "Contract.transfer" }, operation: rpc("eth_sendRawTransaction") });
    expect(at(r, "treasury.ts", 34)).toMatchObject({ sdk: { chain: "Contract.balanceOf" }, operation: rpc("eth_call") });
    // `token: Contract`: neither the ABI nor the runner is known
    expect(at(r, "treasury.ts", 38).operation).toEqual(rpc("eth_call", { alternatives: ["eth_call", "eth_sendRawTransaction", "eth_sendTransaction"] }));
    // a Hardhat artifact's `abi`, also through `require`
    expect(at(r, "rewards.ts", 9).operation).toEqual(rpc("eth_call"));
    expect(at(r, "rewards.ts", 14).operation).toEqual(rpc("eth_sendRawTransaction"));
  });

  it("contracts on a browser wallet send nothing over HTTP, however they are reached", async () => {
    expect((await scanFixture("rpc-contracts/typechain-wallet")).calls).toEqual([]);
  });
});
