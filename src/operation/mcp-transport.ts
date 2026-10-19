import type { McpTransport, UrlShape } from "../types.js";

/**
 * The MCP transport a client sends through (`Call.transport`): Streamable HTTP or the older HTTP+SSE transport, as the
 * code's construction (`SSEClientTransport`) or a configuration's value (`transport: "sse"`, `type: "http"`) says.
 */

type Kind = McpTransport["kind"];

/** Transport values of configurations, by the kind they name; others (`stdio`, opencode's `remote`) name none. */
const KINDS: Record<string, Kind> = {
  sse: "sse",
  http: "streamable-http",
  "streamable-http": "streamable-http",
  streamable_http: "streamable-http",
  streamableHttp: "streamable-http",
};

/** The kind a configuration's transport value names, if it names one. */
export const transportKind = (value: string | undefined): Kind | undefined => (value !== undefined && Object.hasOwn(KINDS, value) ? KINDS[value] : undefined);

/** A known kind as a transport: with the construction's name, when the code names one. */
export const transportOf = (kind: Kind | undefined, name?: string): McpTransport | undefined => (kind ? { kind, ...(name ? { name } : {}) } : undefined);

/**
 * The transport FastMCP picks for a server URL (`Client("https://.../mcp")`): SSE when its path has an `/sse` segment,
 * else Streamable HTTP. Only for a URL the code writes whole: a path read at run time can say either.
 */
export function urlPathTransport(url: UrlShape): McpTransport | undefined {
  if (url.hostKind !== "literal" && url.hostKind !== "const") return undefined;
  const path = url.pathTemplate;
  if (/\/sse(?:\/|$)/.test(path)) return { kind: "sse" };
  return path.includes("{") ? undefined : { kind: "streamable-http" };
}
