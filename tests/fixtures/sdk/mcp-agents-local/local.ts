import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { MCPClient } from "@mastra/mcp";
import { hostedMcpTool, MCPServerStdio } from "@openai/agents";
import { experimental_createMCPClient } from "ai";
import { Experimental_StdioMCPTransport } from "ai/mcp-stdio";

// local processes (stdio): no HTTP request
export async function scriptTools() {
  const client = await experimental_createMCPClient({ transport: new Experimental_StdioMCPTransport({ command: "node", args: ["./server.js"] }) });
  return client.tools();
}

const files = new MCPServerStdio({ name: "files", fullCommand: "npx -y @example/files-server ./data" });

export async function fileTools() {
  await files.connect();
  return files.listTools();
}

const local = new MultiServerMCPClient({ mcpServers: { fs: { transport: "stdio", command: "npx", args: ["-y", "@example/fs-mcp"] } } });

export async function fsTools() {
  return local.getTools();
}

export const shell = new MCPClient({ servers: { shell: { command: "npx", args: ["-y", "@example/shell-mcp"] } } });

// a configuration the scan cannot read: maybe local processes only
export async function configuredTools(client: MultiServerMCPClient) {
  return client.getTools();
}

// a server OpenAI's platform connects to, on its side
export const deepwiki = hostedMcpTool({ serverLabel: "wiki", serverUrl: "https://mcp.example-wiki.dev/mcp" });
