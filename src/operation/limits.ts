import type { Call, Operation, UnfollowedCall } from "../report/schema.js";

/**
 * Bounds past which a GraphQL document is not fully read (#55): the call keeps the name and type its header gives, and
 * leaves `fields` out (or, past `operations`, names no operation). Each is the `detail` of a `graphql-limit` entry in
 * `diagnostics.unfollowed`, so a missing `fields` never reads as a complete scan.
 */
export type GraphqlLimit =
  /** The document's text is over 100,000 characters. */
  | "document-size"
  /** A document built from over 1,000 parts (fragments interpolated into fragments). */
  | "document-parts"
  /** Over 50,000 parser tokens. */
  | "tokens"
  /** Selection sets nested over 32 deep, fragments included. */
  | "depth"
  /** Over 20,000 selection sets visited while inlining fragments. */
  | "fragment-expansion"
  /** Over 2,000 field paths in one operation. */
  | "fields"
  /** Over 50 distinct operations in one request. */
  | "operations"
  /** A document written as its AST over 4,000,000 characters, 200,000 values or 128 levels of nesting. */
  | "ast-size"
  | "ast-nodes"
  | "ast-nesting";

/** Operations read from a document past a bound. Keyed by the object the report's call holds, never copied. */
const reached = new WeakMap<Operation, GraphqlLimit>();

/** Records that `op` comes from a document read past `limit`; the first bound recorded is kept. */
export function withLimit(op: Operation, limit: GraphqlLimit | undefined): Operation {
  if (limit && !reached.has(op)) reached.set(op, limit);
  return op;
}

/** The bound the document of `op` was read past, if any. */
export const limitOf = (op: Operation): GraphqlLimit | undefined => reached.get(op);

/** `{ ...op, batch: true }` keeping the bound `op` was read past. */
export const copyLimit = (from: Operation, to: Operation): Operation => withLimit(to, limitOf(from));

/** One `graphql-limit` entry per location and bound of the calls built from one request. */
export function limitDiagnostics(calls: Call[]): UnfollowedCall[] {
  const out = new Map<string, UnfollowedCall>();
  for (const c of calls) {
    const limit = c.operation && limitOf(c.operation);
    const key = `${c.location.file}:${c.location.line}:${limit}`;
    if (limit && !out.has(key)) out.set(key, { file: c.location.file, line: c.location.line, reason: "graphql-limit", detail: limit });
  }
  return [...out.values()];
}
