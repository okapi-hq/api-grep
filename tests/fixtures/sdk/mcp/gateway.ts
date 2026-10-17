import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const SERVER_URL = "https://tools.harbor-notes.dev/mcp";

export class NotesGateway {
  private client = new Client({ name: "notes-gateway", version: "2.1.0" });

  async open(token: string) {
    const headers = { Authorization: `Bearer ${token}` };
    try {
      await this.client.connect(new StreamableHTTPClientTransport(new URL(SERVER_URL), { requestInit: { headers } }));
    } catch {
      await this.client.connect(new SSEClientTransport(new URL(SERVER_URL), { requestInit: { headers } }));
    }
  }

  async search(query: string) {
    return this.client.callTool({ name: "search_notes", arguments: { query, limit: 10 } });
  }

  async run(tool: string, args: Record<string, unknown>) {
    return this.client.callTool({ name: tool, arguments: args });
  }

  async note(id: string) {
    return this.client.readResource({ uri: `notes://${id}` });
  }

  async summary(topic: string) {
    return this.client.getPrompt({ name: "summarize", arguments: { topic } });
  }
}
