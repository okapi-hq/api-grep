import { describe, expect, it } from "vitest";
import type { Report } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

/** `file:line operation transport` of the MCP calls, the transport as `kind/name`. */
const transports = (r: Report): string[] =>
  r.calls
    .filter((c) => c.operation?.protocol === "mcp")
    .map((c) => `${c.location.file}:${c.location.line} ${c.operation!.name} ${c.transport ? `${c.transport.kind}${c.transport.name ? `/${c.transport.name}` : ""}` : "-"}`);

describe("JSON-RPC requests written by hand that send an MCP method", () => {
  it("typescript: the tool, prompt or resource the request names; the protocol stays JSON-RPC", async () => {
    const r = await scanFixture("json-rpc-mcp", { examples: 0 });
    expect(at(r, "tools.ts", 4).operation).toEqual({ protocol: "json-rpc", name: "tools/call", target: "web_search", dynamic: false, from: "body" });
    expect(at(r, "tools.ts", 20).operation).toMatchObject({ name: "resources/read", target: "issue://{id}" });
    expect(at(r, "tools.ts", 31).operation).toMatchObject({ name: "prompts/get", target: "forecast_summary" });
    // a method with no target, a target the scan cannot read, a method of another protocol: no target
    expect([21, 24, 39].map((line) => at(r, "tools.ts", line).operation?.target)).toEqual([undefined, undefined, undefined]);
    // inside the helper, a branch picks one of several methods: no target
    expect(at(r, "tools.ts", 12).operation).toMatchObject({ name: "resources/read", alternatives: ["resources/read", "tools/list"] });
    expect(at(r, "tools.ts", 12).operation?.target).toBeUndefined();
    expect(r.calls.some((c) => c.transport)).toBe(false);
  });

  it("python: requests and httpx", async () => {
    const r = await scanFixture("python/json-rpc-mcp", { examples: 0 });
    expect(at(r, "tools.py", 9).operation).toEqual({ protocol: "json-rpc", name: "tools/call", target: "web_search", dynamic: false, from: "body" });
    expect(at(r, "tools.py", 13).operation).toMatchObject({ name: "resources/read", target: "issue://{issue_id}" });
    expect(at(r, "tools.py", 17).operation?.target).toBeUndefined();
    expect(at(r, "tools.py", 13).provider).toBe("linear");
  });
});

describe("The transport of MCP calls", () => {
  it("typescript SDK: the transport construction the client is connected with", async () => {
    const r = await scanFixture("sdk/mcp", { examples: 0 });
    expect(transports(r).filter((t) => t.startsWith("gateway.ts") || t.startsWith("tools.ts"))).toEqual([
      "gateway.ts:13 initialize streamable-http/StreamableHTTPClientTransport",
      "gateway.ts:15 initialize sse/SSEClientTransport",
      // the client is connected over either: its calls' transport is not known
      "gateway.ts:20 tools/call -",
      "gateway.ts:24 tools/call -",
      "gateway.ts:28 resources/read -",
      "gateway.ts:32 prompts/get -",
      "tools.ts:8 initialize streamable-http/StreamableHTTPClientTransport",
      "tools.ts:9 tools/list streamable-http/StreamableHTTPClientTransport",
      "tools.ts:10 tools/call streamable-http/StreamableHTTPClientTransport",
    ]);
  });

  it("python SDKs: the stream function or transport, and FastMCP's rule for a URL", async () => {
    const r = await scanFixture("python/mcp", { examples: 0 });
    expect(transports(r)).toEqual([
      "fast_client.py:7 tools/call streamable-http",
      "fast_client.py:13 prompts/list streamable-http/StreamableHttpTransport",
      "fast_client.py:14 prompts/get streamable-http/StreamableHttpTransport",
      "fast_client.py:20 tools/list sse",
      "session.py:15 initialize streamable-http/streamablehttp_client",
      "session.py:16 tools/list streamable-http/streamablehttp_client",
      "session.py:17 tools/call streamable-http/streamablehttp_client",
      "session.py:24 initialize sse/sse_client",
      "session.py:25 resources/read sse/sse_client",
      "session.py:37 initialize streamable-http/streamablehttp_client",
      "session.py:40 tools/call streamable-http/streamablehttp_client",
    ]);
  });

});

describe("The transport of agent frameworks' MCP calls", () => {
  it("agent frameworks: a configuration's transport value, a client or transport construction; none when unsaid", async () => {
    const ts = transports(await scanFixture("sdk/mcp-agents", { examples: 0 }));
    expect(ts).toContain("ai-sdk.ts:7 initialize sse");
    expect(ts).toContain("ai-sdk.ts:20 initialize streamable-http/StreamableHTTPClientTransport");
    expect(ts).toContain("langchain.ts:17 initialize sse");
    expect(ts).toContain("openai-agents.ts:19 initialize sse/MCPServerSSE");
    expect(ts).toContain("mastra.ts:3 initialize -");
    const py = transports(await scanFixture("python/mcp-agents", { examples: 0 }));
    expect(py).toContain("agents_sdk.py:19 initialize sse/MCPServerSse");
    expect(py).toContain("toolkits.py:14 initialize sse/MCPServerSSE");
    expect(py).toContain("toolkits.py:22 initialize streamable-http/StreamableHTTPConnectionParams");
    expect(py).toContain("toolkits.py:27 initialize streamable-http");
    expect(py).toContain("langchain_tools.py:21 initialize sse");
    expect(py).toContain("toolkits.py:32 initialize -");
  });

  it("is reported on MCP calls only", async () => {
    const r = await scanFixture("sdk/mcp-agents", { examples: 0 });
    expect(r.calls.filter((c) => c.transport).every((c) => c.operation?.protocol === "mcp")).toBe(true);
    expect(r.calls.filter((c) => c.operation?.protocol !== "mcp").some((c) => c.transport)).toBe(false);
  });
});
