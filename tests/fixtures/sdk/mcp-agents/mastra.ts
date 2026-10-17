import { MCPClient, MCPConfiguration } from "@mastra/mcp";

export const opsMcp = new MCPClient({
  id: "ops",
  servers: {
    pager: {
      url: new URL("https://mcp.nightowl-ops.dev/mcp"),
      requestInit: { headers: { Authorization: `Bearer ${process.env.NIGHTOWL_TOKEN}` } },
    },
    shell: { command: "npx", args: ["-y", "@example/shell-mcp"] },
  },
});

export async function opsTools() {
  return opsMcp.getTools();
}

export const legacyMcp = new MCPConfiguration({
  servers: { status: { url: new URL("https://status.nightowl-ops.dev/sse") } },
});
