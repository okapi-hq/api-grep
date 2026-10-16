import type { Operation } from "../report/schema.js";
import type { MethodSpec, Shape } from "../types.js";
import { namesOf } from "./names.js";

/**
 * MCP (Model Context Protocol) client requests: JSON-RPC to the one URL of the server, the method named by the client
 * method (`callTool` sends `tools/call`). `target` is what the method names on the server (the tool, the prompt, the
 * resource URI), when one value is known.
 */
export function mcpOperation(spec: MethodSpec, target: Shape | undefined): Operation | undefined {
  if (spec.mcp === undefined) return undefined;
  const named = target ? namesOf(target).names : [];
  return { protocol: "mcp", name: spec.mcp, ...(named.length === 1 ? { target: named[0] } : {}), dynamic: false, from: "body" };
}
