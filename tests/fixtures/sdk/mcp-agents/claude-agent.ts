import { createSdkMcpServer, query } from "@anthropic-ai/claude-agent-sdk";

const trackerServers = {
  tracker: { type: "http" as const, url: "https://mcp.burrowtrack.dev/mcp", headers: { Authorization: `Bearer ${process.env.BURROW_TOKEN}` } },
  docs: { type: "sse" as const, url: "https://docs.burrowtrack.dev/sse" },
  git: { command: "npx", args: ["-y", "@example/git-mcp"] },
};

export async function review(diff: string) {
  const notes: string[] = [];
  for await (const message of query({ prompt: `Review this diff:\n${diff}`, options: { model: "claude-sonnet-4-5", mcpServers: trackerServers } })) {
    if (message.type === "result") notes.push(String(message));
  }
  return notes;
}

// local servers only: the model request, no MCP call
const helpers = createSdkMcpServer({ name: "helpers", version: "1.0.0", tools: [] });

export async function summarize(text: string) {
  for await (const message of query({ prompt: text, options: { mcpServers: { helpers, shell: { type: "stdio", command: "bash" } } } })) {
    if (message.type === "result") return message;
  }
  return undefined;
}
