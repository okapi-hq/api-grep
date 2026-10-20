import { z } from "zod";

/** The MCP transport of a call: the parts of a report about how an MCP client reaches its server. */

export const McpTransportSchema = z
  .object({
    kind: z
      .enum(["streamable-http", "sse"])
      .describe(
        "streamable-http: MCP's Streamable HTTP transport (JSON-RPC POSTed to the server's one endpoint). sse: the older HTTP+SSE transport (an event stream opened with a GET, messages POSTed to the endpoint it names), which servers are retiring.",
      ),
    name: z
      .string()
      .optional()
      .describe(
        "The transport construction the code uses (`StreamableHTTPClientTransport`, `SSEClientTransport`, `streamablehttp_client`, `sse_client`, FastMCP's `SSETransport`, OpenAI Agents' `MCPServerSse`). Absent when a configuration names the kind only (`transport: \"sse\"`, `type: \"http\"`) or a library picks it from the URL.",
      ),
  })
  .meta({
    id: "McpTransport",
    description:
      "Since 1.28.0: the transport an MCP client sends through, when the code or its configuration says so (a transport construction, a configuration's `transport` / `type` value, a configuration file's key, or the rule a library documents for a URL).",
  });
