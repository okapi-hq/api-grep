import { describe, expect, it } from "vitest";
import type { Report } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

/** `file:line operation(target) url transport` of the MCP calls, the transport as `kind/name`. */
const mcpCalls = (r: Report): string[] =>
  r.calls
    .filter((c) => c.operation?.protocol === "mcp")
    .map((c) => {
      const op = `${c.operation!.name}${c.operation!.target ? `(${c.operation!.target})` : ""}`;
      return `${c.location.file}:${c.location.line} ${op} ${c.urlTemplate} ${c.transport ? `${c.transport.kind}/${c.transport.name}` : "-"}`;
    });

describe("MCP clients on the JVM", () => {
  it("java: the Java SDK's clients, at the URL their transport resolves; stdio clients and servers send none", async () => {
    const r = await scanFixture("java/mcp", { examples: 0 });
    expect(mcpCalls(r)).toEqual([
      "ForecastAgent.java:20 initialize https://tools.harbor.example.com/mcp streamable-http/HttpClientStreamableHttpTransport",
      "ForecastAgent.java:21 tools/list https://tools.harbor.example.com/mcp streamable-http/HttpClientStreamableHttpTransport",
      "ForecastAgent.java:22 tools/call(get_forecast) https://tools.harbor.example.com/mcp streamable-http/HttpClientStreamableHttpTransport",
      "ForecastAgent.java:23 resources/read(file:///tides/today.json) https://tools.harbor.example.com/mcp streamable-http/HttpClientStreamableHttpTransport",
      "ForecastAgent.java:24 prompts/get(daily_brief) https://tools.harbor.example.com/mcp streamable-http/HttpClientStreamableHttpTransport",
      // `sseEndpoint(...)` replaces the default `/sse`
      "TicketDesk.java:14 initialize {env:HELPDESK_MCP_URL}/v2/events sse/HttpClientSseClientTransport",
      "TicketDesk.java:15 tools/call(search_tickets) {env:HELPDESK_MCP_URL}/v2/events sse/HttpClientSseClientTransport",
      "TicketDesk.java:16 prompts/list {env:HELPDESK_MCP_URL}/v2/events sse/HttpClientSseClientTransport",
      // the 0.x constructor, with the default SSE endpoint
      "TicketDesk.java:22 ping http://localhost:7070/sse sse/HttpClientSseClientTransport",
      // a relative endpoint resolved against the base URL's directory (RFC 3986)
      "TicketDesk.java:28 tools/call(close_ticket) https://gateway.harbor.example.com/teams/ops/rpc streamable-http/HttpClientStreamableHttpTransport",
      // an injected client: its server is not in the code
      "ToolRouter.java:14 tools/list https://{mcpServer} -",
    ]);
    expect(at(r, "ForecastAgent.java", 22)).toMatchObject({ method: "POST", provider: "mcp", body: { properties: { city: { type: "string" }, days: { enum: [3] } } } });
    expect(at(r, "TicketDesk.java", 15).body).toMatchObject({ properties: { query: { type: "string" } } });
    expect(r.calls.some((c) => c.location.file === "LocalTools.java" || c.location.file === "ToolServer.java")).toBe(false);
    expect(r.coverage?.sdks).toEqual([expect.objectContaining({ package: "io.modelcontextprotocol.sdk:mcp", status: "ok", calls: 11 })]);
  });

  it("kotlin: the Kotlin SDK's Client connected in the file, Ktor helpers, and the Java SDK from Kotlin", async () => {
    const r = await scanFixture("kotlin/mcp", { examples: 0 });
    expect(mcpCalls(r)).toEqual([
      // `client.connect(transport)` sends `initialize`, and gives the client's other calls their transport
      "Concierge.kt:18 initialize https://tools.lagoon.example.com/mcp streamable-http/StreamableHttpClientTransport",
      "Concierge.kt:22 tools/list https://tools.lagoon.example.com/mcp streamable-http/StreamableHttpClientTransport",
      "Concierge.kt:23 tools/call(book_room) https://tools.lagoon.example.com/mcp streamable-http/StreamableHttpClientTransport",
      "Concierge.kt:24 ping https://tools.lagoon.example.com/mcp streamable-http/StreamableHttpClientTransport",
      "Concierge.kt:29 tools/call(current_conditions) https://weather.lagoon.example.com/sse sse/mcpSse",
      "Concierge.kt:33 prompts/get(welcome_note) https://tools.lagoon.example.com/mcp streamable-http/StreamableHttpClientTransport",
      "JavaSdkClient.kt:11 initialize {baseUrl}/api/mcp streamable-http/HttpClientStreamableHttpTransport",
      "JavaSdkClient.kt:12 tools/call(sync_rates) {baseUrl}/api/mcp streamable-http/HttpClientStreamableHttpTransport",
    ]);
    expect(at(r, "Concierge.kt", 23).body).toMatchObject({ properties: { room: { type: "string" }, nights: { enum: [2] } } });
    expect(at(r, "Concierge.kt", 33).body).toMatchObject({ properties: { guest: { type: "string" } } });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([
      ["io.modelcontextprotocol.sdk:mcp", "ok"],
      ["io.modelcontextprotocol:kotlin-sdk-client", "ok"],
    ]);
  });
});
