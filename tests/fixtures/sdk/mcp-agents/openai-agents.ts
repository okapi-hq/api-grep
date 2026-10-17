import { Agent, MCPServerSSE, MCPServerStdio, MCPServerStreamableHttp, run } from "@openai/agents";

const crm = new MCPServerStreamableHttp({
  name: "crm",
  url: "https://mcp.tallyhouse-crm.dev/mcp",
  requestInit: { headers: { Authorization: `Bearer ${process.env.TALLYHOUSE_TOKEN}` } },
});
const files = new MCPServerStdio({ name: "files", fullCommand: "npx -y @example/files-server ./data" });

export async function answer(question: string) {
  await crm.connect();
  const tools = await crm.listTools();
  const contact = await crm.callTool("find_contact", { query: question });
  const agent = new Agent({ name: "Desk", model: "gpt-4.1", mcpServers: [crm, files] });
  return { tools, contact, result: await run(agent, question) };
}

export function legacyServer() {
  return new MCPServerSSE({ name: "legacy", url: "https://mcp.tallyhouse-crm.dev/sse" });
}

// a server built elsewhere: an HTTP one, whose URL is not known here
export async function serverTools(server: MCPServerStreamableHttp) {
  return server.listTools();
}
