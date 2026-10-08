import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "assistant", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL("https://mcp.example-tools.dev/mcp"));

export async function run(city: string) {
  await client.connect(transport);
  const tools = await client.listTools();
  const result = await client.callTool({ name: "forecast", arguments: { city } });
  return { tools, result };
}
