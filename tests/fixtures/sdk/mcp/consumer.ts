import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

// a client connected elsewhere: its server is not known here
export async function describeServer(client: Client) {
  const [tools, prompts, resources] = await Promise.all([client.listTools(), client.listPrompts(), client.listResources()]);
  return { tools, prompts, resources };
}
