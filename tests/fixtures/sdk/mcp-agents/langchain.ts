import { MultiServerMCPClient } from "@langchain/mcp-adapters";

const client = new MultiServerMCPClient({
  throwOnLoadError: true,
  mcpServers: {
    kb: { transport: "http", url: "https://mcp.quillstack.dev/mcp", headers: { Authorization: `Bearer ${process.env.QUILL_TOKEN}` } },
    search: { url: "https://search.quillstack.dev/sse", transport: "sse" },
    math: { transport: "stdio", command: "node", args: ["./servers/math.js"] },
  },
});

export async function knowledgeTools() {
  return client.getTools();
}

// the servers at the top level, as older releases took them
export const legacy = new MultiServerMCPClient({
  notes: { transport: "sse", url: "https://notes.quillstack.dev/sse" },
});

// servers set up only with a token: the servers of either branch
export function searchClient(token?: string) {
  return new MultiServerMCPClient({ mcpServers: token ? { search: { url: "https://search.quillstack.dev/mcp", transport: "http" } } : {} });
}
