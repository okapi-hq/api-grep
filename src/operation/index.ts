import type { ResolvedCall } from "../assemble.js";
import type { Operation } from "../report/schema.js";
import { actionOperations } from "./action.js";
import { graphqlOperations } from "./graphql.js";
import { jsonRpcOperations } from "./json-rpc.js";
import { soapOperations } from "./soap.js";

type Protocol = (r: ResolvedCall) => Operation[];

// an SDK call's endpoint is its registry's; the body it is given is the method's arguments, not an envelope
const notSdk = (protocol: Protocol): Protocol => (r) => (r.client === "sdk" ? [] : protocol(r));

/**
 * Protocols that name the operation outside the URL (#30), read from what a front end resolved, the same way for
 * every language. Each returns the operations a request sends (several for a batch), or none; the first protocol
 * that recognizes the request wins. GraphQL reads an SDK method's document argument (Octokit `graphql()`) and skips
 * other SDK calls itself.
 */
const PROTOCOLS: Protocol[] = [notSdk((r) => jsonRpcOperations(r.body)), graphqlOperations, notSdk(soapOperations), notSdk(actionOperations)];

export function operationsOf(r: ResolvedCall): Operation[] {
  for (const protocol of PROTOCOLS) {
    const ops = protocol(r);
    if (ops.length > 0) return ops;
  }
  return [];
}
