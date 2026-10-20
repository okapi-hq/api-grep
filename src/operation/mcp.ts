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
  const named = mcpTarget(target);
  return { protocol: "mcp", name: spec.mcp, ...(named !== undefined ? { target: named } : {}), dynamic: false, from: "body" };
}

/** The one name a target value holds (`{placeholder}` for parts not known statically); none for several or none. */
export function mcpTarget(target: Shape | undefined): string | undefined {
  const named = target ? namesOf(target).names : [];
  return named.length === 1 ? named[0] : undefined;
}

/** The methods only MCP defines that name something on the server, and the `params` member naming it. */
const TARGET_PARAMS: Record<string, string> = {
  "tools/call": "name",
  "prompts/get": "name",
  "resources/read": "uri",
  "resources/subscribe": "uri",
  "resources/unsubscribe": "uri",
};

/** The member of `params` a JSON-RPC request sending this method names its target with (`tools/call`: `name`). */
export const mcpTargetParam = (method: string): string | undefined => (Object.hasOwn(TARGET_PARAMS, method) ? TARGET_PARAMS[method] : undefined);
