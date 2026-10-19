import path from "node:path";
import type { McpTransport } from "../../types.js";

/**
 * What each tool's configuration format says, as data (from the tools' documentation). Most share one shape: a map
 * of servers by name, a remote one with a URL, its `headers`, and a `type` or `transport` naming the transport.
 */

type Kind = McpTransport["kind"];

export interface ToolFormat {
  /** Keys of the root holding the servers by name. */
  maps: string[];
  /** Keys of a server's URL, in the order the tool reads them, and the transport a key means when it means one. */
  urls: [string, Kind | undefined][];
  /** The transport of a server whose `type` says none, when the tool documents one. */
  defaultKind?: Kind;
  /** Keys of a server's headers (`Name: value`), and of headers whose values are env var names (Codex). */
  headers: string[];
  envHeaders?: string;
  /** Key naming the env var a bearer token is read from (Codex). */
  bearerEnv?: string;
}

const COMMON_URLS: [string, Kind | undefined][] = [
  ["url", undefined],
  ["serverUrl", undefined],
];

/** Claude Code, Claude Desktop, Cursor, Windsurf, Roo, Kiro, Amazon Q (`mcpServers`), VS Code (`servers`), opencode (`mcp`), Zed. */
const GENERIC: ToolFormat = { maps: ["mcpServers", "servers", "mcp", "context_servers"], urls: COMMON_URLS, headers: ["headers"] };

const FORMATS: Record<string, ToolFormat> = {
  // Gemini CLI: `httpUrl` is a Streamable HTTP endpoint, `url` an SSE one
  gemini: { maps: ["mcpServers"], urls: [["httpUrl", "streamable-http"], ["url", "sse"]], headers: ["headers"] },
  // Cline: a remote server with no `type` uses the SSE transport
  cline: { maps: ["mcpServers"], urls: COMMON_URLS, defaultKind: "sse", headers: ["headers"] },
  // Codex CLI: remote servers are Streamable HTTP
  codex: {
    maps: ["mcp_servers"],
    urls: COMMON_URLS,
    defaultKind: "streamable-http",
    headers: ["http_headers"],
    envHeaders: "env_http_headers",
    bearerEnv: "bearer_token_env_var",
  },
};

/** The format of a configuration file, by its name and directory. */
export function formatOf(file: string): ToolFormat {
  const name = path.basename(file);
  const dir = path.basename(path.dirname(file));
  if (name === "settings.json" && dir === ".gemini") return FORMATS.gemini!;
  if (name === "cline_mcp_settings.json") return FORMATS.cline!;
  if (name === "config.toml") return FORMATS.codex!;
  return GENERIC;
}

/** `type` / `transport` values of a server that runs locally or over another protocol: not an HTTP server. */
export const NOT_HTTP = new Set(["stdio", "local", "ws", "websocket"]);

/** Keys of a server naming its transport. */
export const TRANSPORT_KEYS = ["type", "transport", "transportType"];
