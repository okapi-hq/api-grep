import { assembleCalls } from "../../assemble.js";
import { addHeader, type HeadersResult } from "../../resolve/header-names.js";
import { partsToUrlShape } from "../../resolve/url-shape.js";
import type { Call } from "../../report/schema.js";
import type { Document } from "./document.js";
import { valueParts } from "./placeholders.js";
import type { ServerDecl } from "./servers.js";

/** The provider of a declared server whose URL names no known service (as for MCP SDK clients). */
const MCP_PROVIDER = "mcp";

function headersOf(decl: ServerDecl): HeadersResult {
  const out: HeadersResult = { names: [], values: {}, authScheme: "none", known: true };
  for (const [name, value] of decl.headers) addHeader(out, name, value);
  return out;
}

/**
 * A remote server a configuration file declares, as the call the tool makes to it: the `initialize` request the
 * tool's MCP client opens the session with, POSTed to the server's URL, at the place the URL is written.
 */
export function buildServerCall(decl: ServerDecl, file: string, doc: Document, envHints: Record<string, string>): Call[] {
  const { line, col } = doc.locate(decl.url, decl.name);
  const url = partsToUrlShape(valueParts(decl.url.value), { envHints });
  const headers = headersOf(decl);
  return assembleCalls({
    location: { file, line, col, language: "mcp-config" },
    client: "mcp-config",
    url,
    method: "POST",
    dynamic: [...url.dynamic],
    body: { encoding: "json", dynamic: [], fromLiteral: false },
    headers: { names: headers.names, values: headers.values, authScheme: headers.authScheme },
    query: { names: [], shape: {} },
    operation: { protocol: "mcp", name: "initialize", dynamic: false, from: "body" },
    ...(decl.kind ? { transport: { kind: decl.kind } } : {}),
    fallbackProvider: MCP_PROVIDER,
  });
}
