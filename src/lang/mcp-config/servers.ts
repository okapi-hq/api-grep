import { transportKind } from "../../operation/mcp-transport.js";
import type { McpTransport, Part } from "../../types.js";
import { bridgeOf } from "./bridges.js";
import { member, stringAt, type Value } from "./document.js";
import { envPart, valueParts } from "./placeholders.js";
import { NOT_HTTP, TRANSPORT_KEYS, type ToolFormat } from "./tools.js";

/**
 * The remote servers a configuration declares: each server of its maps (`mcpServers`, `servers`, `mcp`,
 * `context_servers`, Codex's `mcp_servers`) with a URL, or running a bridge to one. A server that runs a local
 * process, or whose `type` names a local or non-HTTP transport, is none.
 */

type StringValue = Extract<Value, { kind: "string" }>;

export interface ServerDecl {
  /** The server's name in its map (the text its URL is found after, in formats without positions). */
  name: string;
  url: StringValue;
  headers: [string, Part[]][];
  kind?: McpTransport["kind"];
}

/** Servers read per file: a bound on hostile input. */
export const MAX_SERVERS = 50;

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** The server maps of a file: opencode's `mcp` is one, VS Code settings' `mcp` holds `servers`. */
function serverMaps(root: Value, format: ToolFormat): Map<string, Value>[] {
  const out: Map<string, Value>[] = [];
  for (const key of format.maps) {
    const v = member(root, key);
    const inner = member(v, "servers");
    const map = inner?.kind === "object" ? inner : v;
    if (map?.kind === "object") out.push(map.entries);
  }
  return out;
}

const strings = (v: Value | undefined): StringValue[] => (v?.kind === "array" ? v.items.filter((i): i is StringValue => i.kind === "string") : v?.kind === "string" ? [v] : []);

/** The command line of a local server: `command` and `args`, a command array (opencode), or Zed's `{ path, args }`. */
function argvOf(server: Value): StringValue[] {
  const command = member(server, "command");
  if (command?.kind === "object") return [...strings(member(command, "path")), ...strings(member(command, "args"))];
  return [...strings(command), ...strings(member(server, "args"))];
}

function headersOf(server: Value, format: ToolFormat): [string, Part[]][] {
  const out: [string, Part[]][] = [];
  for (const key of format.headers) {
    const map = member(server, key);
    for (const [name, v] of map?.kind === "object" ? map.entries : []) if (v.kind === "string") out.push([name, valueParts(v.value)]);
  }
  const fromEnv = format.envHeaders ? member(server, format.envHeaders) : undefined;
  for (const [name, v] of fromEnv?.kind === "object" ? fromEnv.entries : []) if (v.kind === "string") out.push([name, [envPart(v.value)]]);
  const bearer = format.bearerEnv ? stringAt(server, format.bearerEnv) : undefined;
  if (bearer) out.push(["authorization", [{ kind: "static", text: "Bearer " }, envPart(bearer.value)]]);
  return out.filter(([name]) => HEADER_NAME.test(name));
}

/** `Name: value` arguments of a bridge, as headers. */
function headerArgs(args: StringValue[]): [string, Part[]][] {
  return args.flatMap((a): [string, Part[]][] => {
    const colon = a.value.indexOf(":");
    return colon > 0 ? [[a.value.slice(0, colon).trim(), valueParts(a.value.slice(colon + 1).trimStart())]] : [];
  });
}

function fromBridge(name: string, server: Value): ServerDecl | undefined {
  const b = bridgeOf(argvOf(server));
  if (!b) return undefined;
  const pairs = b.pairs.map(([n, v]): [string, Part[]] => [n.value, valueParts(v.value)]);
  const headers = [...headerArgs(b.headers), ...pairs].filter(([n]) => HEADER_NAME.test(n));
  return { name, url: b.url, headers, ...(b.kind ? { kind: b.kind } : {}) };
}

/** One server: a remote one by its URL, a bridge by its arguments, else none. */
function serverOf(name: string, server: Value, format: ToolFormat): ServerDecl | undefined {
  if (server.kind !== "object") return undefined;
  const declared = TRANSPORT_KEYS.map((k) => stringAt(server, k)?.value).find((v) => v !== undefined);
  if (declared !== undefined && NOT_HTTP.has(declared)) return declared === "stdio" || declared === "local" ? fromBridge(name, server) : undefined;
  const urlKey = format.urls.find(([key]) => stringAt(server, key));
  if (!urlKey) return fromBridge(name, server);
  const kind = declared !== undefined ? transportKind(declared) : (urlKey[1] ?? format.defaultKind);
  return { name, url: stringAt(server, urlKey[0])!, headers: headersOf(server, format), ...(kind ? { kind } : {}) };
}

/** The remote servers of a file, at most `MAX_SERVERS`. */
export function declaredServers(root: Value, format: ToolFormat): ServerDecl[] {
  const out: ServerDecl[] = [];
  for (const map of serverMaps(root, format)) {
    for (const [name, server] of map) {
      if (out.length >= MAX_SERVERS) return out;
      const decl = serverOf(name, server, format);
      if (decl) out.push(decl);
    }
  }
  return out;
}

/** Whether a file has any server map: one without is no MCP configuration (another tool's `settings.json`). */
export const hasServerMap = (root: Value, format: ToolFormat): boolean => serverMaps(root, format).length > 0;

/** A server a file declares by name, local or remote; a remote one with its URL as written. */
export interface ConfiguredServer {
  name: string;
  url?: string;
}

/** Every server of a file, at most `MAX_SERVERS`: what a coding agent's tool names name their server by. */
export function configuredServers(root: Value, format: ToolFormat): ConfiguredServer[] {
  const out: ConfiguredServer[] = [];
  for (const map of serverMaps(root, format)) {
    for (const [name, server] of map) {
      if (out.length >= MAX_SERVERS) return out;
      if (server.kind !== "object") continue;
      const url = serverOf(name, server, format)?.url.value;
      out.push(url === undefined ? { name } : { name, url });
    }
  }
  return out;
}
