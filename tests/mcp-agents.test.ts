import { describe, expect, it } from "vitest";
import type { Report } from "../src/report/schema.js";
import { scanFixture } from "./fixture-helpers.js";

/** `file:line operation url [headers]` of the MCP calls, in report order. */
const mcpCalls = (r: Report): string[] =>
  r.calls
    .filter((c) => c.operation?.protocol === "mcp")
    .map((c) => `${c.location.file}:${c.location.line} ${c.operation!.name}${c.operation!.target ? `(${c.operation!.target})` : ""} ${c.urlTemplate} [${c.headers.join(",")}]`);

describe("MCP servers agent frameworks connect to: TypeScript", () => {
  it("TypeScript: one call per HTTP server of the client, at its construction and at each method", async () => {
    const r = await scanFixture("sdk/mcp-agents", { examples: 0 });
    expect(mcpCalls(r)).toEqual([
      "ai-sdk.ts:7 initialize https://mcp.fernway-travel.dev/sse [authorization]",
      "ai-sdk.ts:10 tools/list https://mcp.fernway-travel.dev/sse [authorization]",
      "ai-sdk.ts:20 initialize https://mcp.pantry-ledger.dev/mcp [x-api-key]",
      "ai-sdk.ts:21 tools/list https://mcp.pantry-ledger.dev/mcp [x-api-key]",
      "ai-sdk.ts:25 initialize {env:LEDGER_MCP_URL} []",
      "ai-sdk.ts:26 tools/list {env:LEDGER_MCP_URL} []",
      "claude-agent.ts:11 initialize https://mcp.burrowtrack.dev/mcp [authorization]",
      "claude-agent.ts:11 initialize https://docs.burrowtrack.dev/sse []",
      "langchain.ts:3 initialize https://mcp.quillstack.dev/mcp [authorization]",
      "langchain.ts:3 initialize https://search.quillstack.dev/sse []",
      "langchain.ts:13 tools/list https://mcp.quillstack.dev/mcp [authorization]",
      "langchain.ts:13 tools/list https://search.quillstack.dev/sse []",
      "langchain.ts:17 initialize https://notes.quillstack.dev/sse []",
      "langchain.ts:23 initialize https://search.quillstack.dev/mcp []",
      "mastra.ts:3 initialize https://mcp.nightowl-ops.dev/mcp [authorization]",
      "mastra.ts:15 tools/list https://mcp.nightowl-ops.dev/mcp [authorization]",
      "mastra.ts:18 initialize https://status.nightowl-ops.dev/sse []",
      "openai-agents.ts:3 initialize https://mcp.tallyhouse-crm.dev/mcp [authorization]",
      "openai-agents.ts:12 tools/list https://mcp.tallyhouse-crm.dev/mcp [authorization]",
      "openai-agents.ts:13 tools/call(find_contact) https://mcp.tallyhouse-crm.dev/mcp [authorization]",
      "openai-agents.ts:19 initialize https://mcp.tallyhouse-crm.dev/sse []",
      "openai-agents.ts:24 tools/list https://{mcpServer} []",
    ]);
    // the model request of `query` keeps its id; each server's call has one of its own
    const ids = r.calls.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.calls.filter((c) => c.location.file === "claude-agent.ts").map((c) => c.provider)).toEqual(["anthropic", "mcp", "mcp", "anthropic"]);
  });
});

describe("MCP servers agent frameworks connect to: Python", () => {
  it("Python: dicts by name, lists, transport objects and URLs; a known vendor's MCP host names its provider", async () => {
    const r = await scanFixture("python/mcp-agents", { examples: 0 });
    expect(mcpCalls(r)).toEqual([
      "agents_sdk.py:8 initialize https://mcp.tallyhouse-crm.dev/mcp [authorization]",
      "agents_sdk.py:12 tools/list https://mcp.tallyhouse-crm.dev/mcp [authorization]",
      "agents_sdk.py:13 tools/call(find_contact) https://mcp.tallyhouse-crm.dev/mcp [authorization]",
      "agents_sdk.py:19 initialize https://mcp.tallyhouse-crm.dev/sse []",
      "claude_agent.py:7 initialize https://mcp.burrowtrack.dev/mcp [authorization]",
      "claude_agent.py:7 initialize https://docs.burrowtrack.dev/sse []",
      "claude_agent.py:25 initialize https://mcp.burrowtrack.dev/mcp []",
      "crew.py:12 initialize https://mcp.lanternworks.dev/mcp [x-api-key]",
      "crew.py:16 initialize https://mcp.lanternworks.dev/search []",
      "crew.py:16 initialize https://archive.lanternworks.dev/mcp [authorization]",
      "langchain_tools.py:21 initialize https://mcp.quillstack.dev/mcp [authorization]",
      "langchain_tools.py:21 initialize https://search.quillstack.dev/sse []",
      "langchain_tools.py:21 initialize https://mcp.linear.app/mcp []",
      "langchain_tools.py:22 tools/list https://mcp.quillstack.dev/mcp [authorization]",
      "langchain_tools.py:22 tools/list https://search.quillstack.dev/sse []",
      "langchain_tools.py:22 tools/list https://mcp.linear.app/mcp []",
      "langchain_tools.py:28 initialize https://mcp.quillstack.dev/mcp []",
      "langchain_tools.py:29 tools/list https://mcp.quillstack.dev/mcp []",
      "toolkits.py:13 initialize https://mcp.drizzle-forecast.dev/mcp [authorization]",
      "toolkits.py:14 initialize https://alerts.drizzle-forecast.dev/sse []",
      "toolkits.py:18 tools/list https://mcp.drizzle-forecast.dev/mcp [authorization]",
      "toolkits.py:22 initialize https://radar.drizzle-forecast.dev/mcp [x-api-key]",
      "toolkits.py:27 initialize https://stations.drizzle-forecast.dev/mcp []",
      "toolkits.py:32 initialize https://archive.drizzle-forecast.dev/sse []",
      "toolkits.py:37 initialize https://tides.drizzle-forecast.dev/mcp [authorization]",
      "toolkits.py:42 tools/list https://tides.drizzle-forecast.dev/mcp [authorization]",
      "toolkits.py:43 tools/call(tide_level) https://tides.drizzle-forecast.dev/mcp [authorization]",
      "toolkits.py:50 initialize https://pollen.drizzle-forecast.dev/mcp [authorization]",
      "toolkits.py:51 tools/call(pollen_count) https://pollen.drizzle-forecast.dev/mcp [authorization]",
      "toolkits.py:55 tools/list https://pollen.drizzle-forecast.dev/sse []",
    ]);
    const ids = r.calls.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.calls.filter((c) => c.urlTemplate.includes("linear.app")).map((c) => c.provider)).toEqual(["linear", "linear"]);
    // CrewAI's agent: its model request and its MCP servers, at the same call
    expect(r.calls.filter((c) => c.location.file === "crew.py" && c.location.line === 16).map((c) => c.provider)).toEqual(["openai", "mcp", "mcp"]);
  });
});
