import { openai } from "@ai-sdk/openai";
import { createMCPClient } from "@ai-sdk/mcp";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { experimental_createMCPClient, generateText } from "ai";

export async function planTrip(request: string, token: string) {
  const client = await experimental_createMCPClient({
    transport: { type: "sse", url: "https://mcp.fernway-travel.dev/sse", headers: { Authorization: `Bearer ${token}` } },
  });
  const tools = await client.tools();
  const { text } = await generateText({ model: openai("gpt-4o"), tools, prompt: request });
  await client.close();
  return text;
}

export async function pantryTools(apiKey: string) {
  const transport = new StreamableHTTPClientTransport(new URL("https://mcp.pantry-ledger.dev/mcp"), {
    requestInit: { headers: { "X-Api-Key": apiKey } },
  });
  const client = await createMCPClient({ transport });
  return client.tools();
}

export async function ledgerTools() {
  const client = await createMCPClient({ transport: { type: "http", url: process.env.LEDGER_MCP_URL! } });
  return client.tools();
}
