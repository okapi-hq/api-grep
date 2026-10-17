import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// an MCP server receives requests: its tools, its transports and `connect` send none
const server = new McpServer({ name: "recipe-box", version: "0.4.0" });

server.tool("find_recipe", { dish: z.string() }, async ({ dish }) => ({ content: [{ type: "text", text: `No ${dish} yet` }] }));

server.registerTool("count_recipes", { description: "How many recipes are stored" }, async () => ({ content: [{ type: "text", text: "0" }] }));

server.resource("pantry", "pantry://items", async (uri) => ({ contents: [{ uri: uri.href, text: "flour" }] }));

export async function serveStdio() {
  await server.connect(new StdioServerTransport());
}

export async function serveHttp(handle: (t: StreamableHTTPServerTransport) => void) {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  handle(transport);
}

export async function notify(srv: McpServer) {
  await srv.server.ping();
  await srv.server.sendToolListChanged();
}
