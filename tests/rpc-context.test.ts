import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

const rpc = (name: string, extra: object = {}): object => ({ protocol: "json-rpc", name, dynamic: false, from: "body", ...extra });

describe("clients handed down by the app's React contexts (#98)", () => {
  it("useContext reads the value of the app's <Ctx.Provider>, through its own hook and a memoized client", async () => {
    const r = await scanFixture("rpc-clients/app-context");
    expect(at(r, "ledger.tsx", 8)).toMatchObject({ sdk: { package: "ethers", chain: "getBlockNumber" }, urlTemplate: "https://ledger.example-node.io/rpc", operation: rpc("eth_blockNumber") });
    expect(at(r, "ledger.tsx", 15)).toMatchObject({ provider: "ledger.example-node.io", operation: rpc("eth_getBalance") });
    // two providers with different nodes: the host depends on where the app renders
    expect(at(r, "regions.tsx", 17)).toMatchObject({ provider: "unknown", operation: rpc("eth_gasPrice") });
    // the wallet's provider handed down a context sends nothing over HTTP
    expect(r.calls.map((c) => `${c.location.file}:${c.location.line}`)).toEqual(["ledger.tsx:8", "ledger.tsx:15", "regions.tsx:17"]);
  });

  it("works for any SDK client, not only JSON-RPC ones", async () => {
    const r = await scanFixture("sdk/react-context");
    expect(at(r, "assistant.tsx", 15)).toMatchObject({ sdk: { package: "@anthropic-ai/sdk", chain: "messages.create" }, urlTemplate: "https://llm.example-gateway.io/v1/messages" });
  });

  it("a wagmi client handed in a context sends through its memoized config; <WagmiProvider> may get one of two configs", async () => {
    const r = await scanFixture("rpc-clients/wagmi-context");
    // `fallback([http(backend), http()])`: two nodes
    expect(at(r, "rates.tsx", 8)).toMatchObject({ sdk: { package: "wagmi", chain: "readContract" }, provider: "unknown", operation: rpc("eth_call") });
    // `IS_TEST ? testConfig : liveConfig`: the node depends on the build
    expect(at(r, "rates.tsx", 13)).toMatchObject({ sdk: { chain: "useBalance" }, provider: "unknown", operation: rpc("eth_getBalance") });
  });
});

describe("clients given in a context object, or by an injected factory (#98)", () => {
  it("an untyped context parameter: the client the callers' object holds", async () => {
    const r = await scanFixture("rpc-clients/context-param");
    expect(r.calls).toHaveLength(1);
    expect(at(r, "jobs.js", 7)).toMatchObject({ provider: "jobs.example-node.io", clientFrom: "caller", operation: rpc("eth_getBalance") });
    expect(r.diagnostics?.unfollowed).toEqual([]);
  });

  it("a factory a constructor is handed: the clients of the functions the callers pass", async () => {
    const r = await scanFixture("rpc-clients/injected-factory");
    // `getReader` fills a cache whose entries all use one node; a provider only reads
    expect(at(r, "services.ts", 11)).toMatchObject({ sdk: { chain: "Contract.balanceOf" }, provider: "reader.example-node.io", operation: rpc("eth_call") });
    expect(at(r, "services.ts", 16)).toMatchObject({ provider: "reader.example-node.io", operation: rpc("eth_blockNumber") });
    // built with `getReader` or `getArchive`
    expect(at(r, "services.ts", 31)).toMatchObject({ provider: "unknown", operation: { name: "eth_getBlockByNumber" } });
    // a factory of the connected wallet's provider
    expect(r.calls.some((c) => c.location.line === 43)).toBe(false);
  });
});

describe("wagmi configs memoized or built by ConnectKit (#98)", () => {
  it("useMemo(() => createConfig(...)) handed to <WagmiProvider>", async () => {
    const r = await scanFixture("rpc-clients/wagmi-memo");
    expect(at(r, "pool.tsx", 6)).toMatchObject({ sdk: { chain: "useReadContract" }, urlTemplate: "https://eth.example-node.io/v1", operation: rpc("eth_call") });
    expect(at(r, "pool.tsx", 7)).toMatchObject({ provider: "eth.example-node.io", operation: rpc("eth_blockNumber") });
  });

  it("ConnectKit's getDefaultConfig: its transports, else wagmi's default HTTP ones; a wallet's transport gives no call", async () => {
    const r = await scanFixture("rpc-clients/wagmi-connectkit");
    expect(r.calls.map((c) => [c.location.file, c.location.line, c.provider, c.operation?.name])).toEqual([
      ["reads.ts", 5, "eth.example-node.io", "eth_blockNumber"],
      ["reads.ts", 9, "unknown", "eth_gasPrice"],
    ]);
  });
});

describe("Python clients kept in a module's dict (#98)", () => {
  it("one host only when every cached client agrees; a URL picked by the cache key leaves it unknown", async () => {
    const r = await scanFixture("python/rpc-cache");
    expect(at(r, "nodes.py", 18)).toMatchObject({ sdk: { package: "web3", chain: "eth.get_block" }, provider: "unknown" });
    expect(at(r, "nodes.py", 33)).toMatchObject({ provider: "env:ARCHIVE_NODE_URL", operation: rpc("eth_getBalance") });
    // `_ledgers.get(name)`: a literal entry and the ones `add_ledger` writes
    expect(at(r, "nodes.py", 49)).toMatchObject({ sdk: { package: "solana" }, provider: "unknown", operation: rpc("getBalance") });
    // a socket among the entries: no call
    expect(r.calls.some((c) => c.location.file === "streams.py" && c.location.line === 17)).toBe(false);
    expect(at(r, "streams.py", 23)).toMatchObject({ provider: "local.example-node.io" });
  });
});
