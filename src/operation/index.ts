import type { ResolvedCall } from "../assemble.js";
import type { Operation } from "../report/schema.js";
import { jsonRpcOperations } from "./json-rpc.js";

/**
 * Protocols that name the operation outside the URL (#30), read from what a front end resolved, the same way for
 * every language. Each returns the operations a request sends (several for a batch), or none; the first protocol
 * that recognizes the request wins.
 */
const PROTOCOLS: ((r: ResolvedCall) => Operation[])[] = [
  // an SDK call's endpoint is its registry's; the body it is given is the method's arguments, not an envelope
  (r) => (r.client === "sdk" ? [] : jsonRpcOperations(r.body)),
];

export function operationsOf(r: ResolvedCall): Operation[] {
  for (const protocol of PROTOCOLS) {
    const ops = protocol(r);
    if (ops.length > 0) return ops;
  }
  return [];
}
