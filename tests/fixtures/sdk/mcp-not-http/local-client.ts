import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// a local server started as a process: stdio, no HTTP request
export async function lint(file: string) {
  const client = new Client({ name: "lint-runner", version: "0.3.0" });
  const transport = new StdioClientTransport({ command: "npx", args: ["-y", "pocket-lint-server"] });
  await client.connect(transport);
  await client.listTools();
  return client.callTool({ name: "lint", arguments: { file } });
}

// an in-process pair, as in a server's own checks
export async function selfCheck(connectServer: (t: unknown) => Promise<void>) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await connectServer(serverSide);
  const probe = new Client({ name: "self-check", version: "0.3.0" });
  await probe.connect(clientSide);
  return probe.listTools();
}
