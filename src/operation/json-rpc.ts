import type { Operation } from "../report/schema.js";
import type { BodyResult } from "../resolve/body.js";
import type { MethodSpec, Shape } from "../types.js";
import { mcpTarget, mcpTargetParam } from "./mcp.js";
import { namesOf } from "./names.js";

/**
 * JSON-RPC (#34): every method goes to one URL and the request body names it. A JSON body is a request when it has a
 * `jsonrpc` member and a `method`, or (JSON-RPC 1.0, still sent by older node clients) a string `method` with
 * `params` and `id`. An array of requests is a batch: one operation per method it sends.
 */

type ObjectShape = Extract<Shape, { type: "object" }>;

/** A 1.0-style body whose `method` is an HTTP verb is a request description sent to a proxy, not a JSON-RPC call. */
const HTTP_VERB = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i;

function isStringish(s: Shape): boolean {
  if (s.type === "union") return s.anyOf.every((m) => m.type === "string" || m.type === "dynamic" || m.type === "unknown");
  return s.type === "string" || s.type === "dynamic";
}

function isRequest(s: Shape): s is ObjectShape {
  if (s.type !== "object") return false;
  const { jsonrpc, method, params, id } = s.properties;
  if (!method) return false;
  if (jsonrpc) return true;
  if (!params || !id || !isStringish(method)) return false;
  return !namesOf(method).names.some((n) => HTTP_VERB.test(n));
}

/**
 * What a request sending one of the methods only MCP defines names on the server (`tools/call`: `params.name`, the
 * tool), read as MCP clients' targets are; the protocol stays JSON-RPC, as nothing else says it is an MCP server.
 */
function targetOf(request: ObjectShape, names: string[]): string | undefined {
  const key = names.length === 1 ? mcpTargetParam(names[0]!) : undefined;
  const params = request.properties.params;
  return key && params?.type === "object" ? mcpTarget(params.properties[key]) : undefined;
}

function operationOf(request: ObjectShape, batch: boolean): Operation {
  const acc = namesOf(request.properties.method!);
  const target = targetOf(request, acc.names);
  return {
    protocol: "json-rpc",
    name: acc.names[0] ?? null,
    ...(target !== undefined ? { target } : {}),
    ...(acc.names.length > 1 ? { alternatives: acc.names } : {}),
    ...(batch ? { batch: true } : {}),
    dynamic: acc.dynamic,
    from: "body",
  };
}

/** The requests of a batch body: each element shape that is a JSON-RPC request. */
function batchRequests(items: Shape): ObjectShape[] {
  const members = items.type === "union" ? items.anyOf : [items];
  return members.filter(isRequest);
}

/** The operations a JSON body sends: one for a request, one per distinct method for a batch, none otherwise. */
export function jsonRpcOperations(body: BodyResult): Operation[] {
  const s = body.shape;
  if (!s || body.encoding !== "json") return [];
  if (isRequest(s)) return [operationOf(s, false)];
  if (s.type !== "array") return [];
  const ops = batchRequests(s.items).map((r) => operationOf(r, true));
  // the same method twice in one batch is one operation
  return ops.filter((op, i) => ops.findIndex((o) => o.name === op.name) === i);
}

/**
 * The operation of a JSON-RPC client library's method (#52): the RPC method its registry names (`rpc`), or the one a
 * generic transport method is given (`send(method, params)`: the shape of that argument). None for other SDK methods.
 */
export function rpcClientOperation(spec: MethodSpec, method: Shape | undefined): Operation | undefined {
  if (spec.rpc !== undefined) {
    const names = typeof spec.rpc === "string" ? [spec.rpc] : spec.rpc;
    return { protocol: "json-rpc", name: names[0] ?? null, ...(names.length > 1 ? { alternatives: names } : {}), dynamic: false, from: "body" };
  }
  if (spec.rpcArg === undefined) return undefined;
  const acc = method ? namesOf(method) : { names: [], dynamic: true };
  return { protocol: "json-rpc", name: acc.names[0] ?? null, ...(acc.names.length > 1 ? { alternatives: acc.names } : {}), dynamic: acc.dynamic, from: "body" };
}
