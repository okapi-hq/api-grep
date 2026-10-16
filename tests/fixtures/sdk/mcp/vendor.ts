import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// a vendor's MCP endpoint: the call is that vendor's
export async function openIssues(team: string) {
  const client = new Client({ name: "triage-bot", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("https://mcp.linear.app/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.TRIAGE_LINEAR_TOKEN}` } },
  });
  await client.connect(transport);
  return client.callTool({ name: "list_issues", arguments: { team, state: "open" } });
}

// a server the configuration names
export async function remoteTools(serverUrl: string, apiKey: string) {
  const client = new Client({ name: "triage-bot", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl), { requestInit: { headers: { "X-Api-Key": apiKey } } }));
  return client.listTools();
}
