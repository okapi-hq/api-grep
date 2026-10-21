import { mcpConfigFiles } from "../lang/mcp-config/files.js";
import { readDocument } from "../lang/mcp-config/index.js";
import { configuredServers } from "../lang/mcp-config/servers.js";
import { formatOf } from "../lang/mcp-config/tools.js";

/**
 * The MCP servers the repository's configuration files declare (the files the `mcp-config` language reads), by the
 * name coding agents give them in tool names, with a remote server's host. A file that does not parse declares none
 * (the `mcp-config` language reports it).
 */

/** Server name -> host of its URL, or undefined for a local server or a URL without a literal host. */
export type DeclaredServers = Map<string, string | undefined>;

/** Coding agents name a server in tool names with every character outside `[A-Za-z0-9_-]` read as `_`. */
export const toolNameOf = (server: string): string => server.replace(/[^A-Za-z0-9_-]/g, "_");

/** The literal host of a URL, lower case; undefined for a template or a value that is no URL. */
export function literalHost(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : undefined;
  } catch {
    return undefined;
  }
}

/** The declared servers of the files under `rootDir` the selection keeps; the first declaration of a name wins. */
export function declaredServers(rootDir: string, include: string[] | undefined, exclude: string[]): DeclaredServers {
  const out: DeclaredServers = new Map();
  for (const file of mcpConfigFiles(rootDir, include, exclude)) {
    let servers;
    try {
      servers = configuredServers(readDocument(file, rootDir).root, formatOf(file));
    } catch {
      continue;
    }
    for (const s of servers) {
      const name = toolNameOf(s.name);
      if (!out.has(name)) out.set(name, s.url === undefined ? undefined : literalHost(s.url));
    }
  }
  return out;
}
