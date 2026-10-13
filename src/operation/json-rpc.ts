import type { Operation } from "../report/schema.js";
import type { BodyResult } from "../resolve/body.js";
import { templateOf } from "../resolve/string-template.js";
import type { Shape } from "../types.js";

/**
 * JSON-RPC (#34): every method goes to one URL and the request body names it. A JSON body is a request when it has a
 * `jsonrpc` member and a `method`, or (JSON-RPC 1.0, still sent by older node clients) a string `method` with
 * `params` and `id`. An array of requests is a batch: one operation per method it sends.
 */

type ObjectShape = Extract<Shape, { type: "object" }>;

/** A 1.0-style body whose `method` is an HTTP verb is a request description sent to a proxy, not a JSON-RPC call. */
const HTTP_VERB = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i;

interface Names {
  names: string[];
  dynamic: boolean;
}

function collect(s: Shape, acc: Names, depth = 0): void {
  if (depth > 6) return;
  if (s.type === "union") {
    for (const member of s.anyOf) collect(member, acc, depth + 1);
    return;
  }
  const values = s.type === "string" ? (s.enum ?? []).filter((v): v is string => typeof v === "string" && v !== "") : [];
  // a computed method keeps its literal parts (`eth_{kind}`); anything else with no literal value is unknown
  const template = s.type === "string" && values.length === 0 ? templateOf(s) : undefined;
  if (values.length === 0) acc.dynamic = true;
  for (const v of template ? [template] : values) if (!acc.names.includes(v)) acc.names.push(v);
}

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
  const named: Names = { names: [], dynamic: false };
  collect(method, named);
  return !named.names.some((n) => HTTP_VERB.test(n));
}

function operationOf(request: ObjectShape, batch: boolean): Operation {
  const acc: Names = { names: [], dynamic: false };
  collect(request.properties.method!, acc);
  return {
    protocol: "json-rpc",
    name: acc.names[0] ?? null,
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
