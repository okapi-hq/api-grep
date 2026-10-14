import type { ResolvedCall } from "../assemble.js";
import type { Operation } from "../report/schema.js";
import { literalOf, partsOf } from "../resolve/string-template.js";
import type { Shape } from "../types.js";
import { documentHeader, readDocument } from "./graphql-document.js";
import { copyLimit, limitOf, withLimit, type GraphqlLimit } from "./limits.js";

/**
 * GraphQL (#35): every operation goes to one endpoint and the document names it. A request is GraphQL when it sends a
 * document that parses with an operation in it (`{ query }` in a JSON body, `?query=` in a GET), or an envelope whose
 * document the scan cannot read but whose other members say GraphQL (`variables`, `operationName`, a persisted query's
 * hash, a `/graphql` path). An array of envelopes is a batch.
 */

type ObjectShape = Extract<Shape, { type: "object" }>;
type From = Operation["from"];

const GRAPHQL_PATH = /graphql/i;

interface Strings {
  /** Literal values, then the literal text of strings built with computed parts (the computed parts left out). */
  values: string[];
  templates: string[];
  /** Some branch has no text at all. */
  unknown: boolean;
  /** Templates of documents a front end cut short past a bound (`truncated()`, #55), with the bound. */
  cut: Map<string, GraphqlLimit>;
  /** A bound past which some text was not read at all: the operation named without it reached it. */
  limit?: GraphqlLimit;
}

/** The bound a front end cut a document's text short at (`truncated()`), if any. */
function cutAt(s: Shape): GraphqlLimit | undefined {
  for (const p of partsOf(s) ?? []) if (p.kind === "dynamic" && p.limit) return p.limit;
  return undefined;
}

function strings(s: Shape | undefined, acc: Strings = { values: [], templates: [], unknown: false, cut: new Map() }, depth = 0): Strings {
  if (!s || depth > 6) {
    acc.unknown = true;
    return acc;
  }
  if (s.type === "union") {
    for (const member of s.anyOf) strings(member, acc, depth + 1);
    return acc;
  }
  const values = s.type === "string" ? (s.enum ?? []).filter((v): v is string => typeof v === "string") : [];
  const template = s.type === "string" && values.length === 0 ? documentTemplate(s) : undefined;
  if (values.length === 0 && !template) acc.unknown = true;
  const cut = cutAt(s);
  if (cut && template) acc.cut.set(template, cut);
  else acc.limit ??= cut;
  acc.values.push(...values.filter((v) => !acc.values.includes(v)));
  if (template && !acc.templates.includes(template)) acc.templates.push(template);
  return acc;
}

/** Marks a computed part while the text is checked: a private-use character, never part of a document's syntax. */
const GAP = "\uE000";
/** `query ${name} {`, `query Get${Kind} {`: a computed operation name. */
const COMPUTED_NAME = /^\s*(?:#[^\n]*\n\s*)*(?:query|mutation|subscription)\s+[_0-9A-Za-z]*\uE000/;

/**
 * The text of a document built with computed parts, read without them: one standing for a fragment or a selection
 * the scan could not resolve would otherwise read as a field. A computed operation name leaves the document unread.
 */
function documentTemplate(s: Shape): string | undefined {
  const text = literalOf(s, GAP);
  return text === undefined || COMPUTED_NAME.test(text) ? undefined : text.replaceAll(GAP, "");
}

const graphql = (name: string | null, from: From, extra: Partial<Operation> = {}): Operation => ({ protocol: "graphql", name, ...extra, dynamic: name === null, from });

/**
 * The operations one document text sends; `operationName` picks one of several. A bound reached parsing the text is
 * recorded in `doc`, for the operation named without it.
 */
function fromText(text: string, operationName: string | undefined, nameFrom: From, doc: Strings): Operation[] | undefined {
  const read = readDocument(text);
  const cut = doc.cut.get(text);
  const ops = read.operations;
  if (!ops) {
    // too large, or computed parts the parser cannot read: the header still names it
    const limit = cut ?? read.limit;
    const header = documentHeader(text);
    if (!header) doc.limit ??= limit;
    return header ? [withLimit(graphql(header.name, "document", { type: header.type }), limit)] : undefined;
  }
  const picked = operationName !== undefined ? ops.filter((op) => op.named && op.name === operationName) : ops;
  if (operationName !== undefined && picked.length === 0) return [withLimit(graphql(operationName, nameFrom), cut)];
  return picked.map((op) => withLimit(graphql(op.name, "document", { type: op.type, ...(op.fields ? { fields: op.fields } : {}) }), op.limit ?? cut));
}

interface Envelope {
  query?: Shape;
  operationName?: Shape;
  /** Another member says GraphQL: `variables`, `extensions`, `operationName`, or the endpoint's path. */
  hinted: boolean;
  persisted: boolean;
}

/** A document is text, or a value the scan could not read; `{ query: { match } }` is a search DSL, not GraphQL. */
function isTextual(s: Shape): boolean {
  if (s.type === "union") return s.anyOf.every(isTextual);
  return s.type === "string" || s.type === "dynamic" || s.type === "unknown";
}

/** The operations of one envelope; none when it is not GraphQL. */
function envelopeOperations(e: Envelope, nameFrom: From): Operation[] {
  const name = strings(e.operationName);
  const operationName = e.operationName && !name.unknown && name.values.length === 1 ? name.values[0] : undefined;
  const doc = e.query && isTextual(e.query) ? strings(e.query) : undefined;
  if (doc) {
    const ops = [...doc.values, ...doc.templates].flatMap((text) => fromText(text, operationName, nameFrom, doc) ?? []);
    if (ops.length > 0) return ops;
    if (!e.hinted) return [];
  } else if (e.query || !e.persisted) {
    return [];
  }
  // the document is not in the code (a persisted query's hash) or could not be read: only `operationName` can name it
  return [withLimit(graphql(operationName ?? null, nameFrom), doc?.limit)];
}

function bodyEnvelope(s: ObjectShape, path: string): Envelope {
  const { query, operationName, variables, extensions } = s.properties;
  const persisted = extensions?.type === "object" && !!extensions.properties.persistedQuery;
  return { query, operationName, hinted: !!(variables || operationName || extensions) || GRAPHQL_PATH.test(path), persisted };
}

/** The requests of a batch body. */
function batchItems(items: Shape): ObjectShape[] {
  const members = items.type === "union" ? items.anyOf : [items];
  return members.filter((m): m is ObjectShape => m.type === "object" && !!(m.properties.query || m.properties.extensions));
}

/** Operations listed for one request; a document of more (generated, or hostile) is one call of an unnamed operation. */
export const MAX_OPERATIONS = 50;

/** One call per operation: the same operation twice (a batch, two branches) is one. */
function distinct(ops: Operation[]): Operation[] {
  const seen = new Map<string, Operation>();
  for (const op of ops) {
    const key = `${op.type ?? ""}:${op.name ?? ""}`;
    const kept = seen.get(key);
    if (kept) withLimit(kept, limitOf(op));
    else seen.set(key, op);
  }
  const out = [...seen.values()];
  if (out.length <= MAX_OPERATIONS) return out;
  const first = out[0]!;
  return [withLimit(graphql(null, first.from, first.batch ? { batch: true } : {}), "operations")];
}

function bodyOperations(r: ResolvedCall): Operation[] {
  const s = r.body.shape;
  if (!s) return [];
  const path = r.url.pathTemplate;
  if (s.type === "object" && r.body.encoding === "json") return envelopeOperations(bodyEnvelope(s, path), "body");
  if (s.type === "array" && r.body.encoding === "json") {
    return batchItems(s.items).flatMap((item) => envelopeOperations(bodyEnvelope(item, path), "body").map((op) => copyLimit(op, { ...op, batch: true })));
  }
  // `Content-Type: application/graphql`: the body is the document
  const contentType = r.headers.values["content-type"] ?? "";
  if (s.type === "string" && /graphql/i.test(contentType)) return envelopeOperations({ query: s, hinted: true, persisted: false }, "body");
  return [];
}

/**
 * The document written into a URL (`?query=${encodeURIComponent(DOC)}`): the URL's template reads its braces as
 * placeholders, so the query parameter's shape has no value; the template's text has it.
 */
function urlDocument(raw: string): Shape | undefined {
  const m = /[?&]query=([^&#]*)/.exec(raw);
  if (!m?.[1]) return undefined;
  let text = m[1];
  try {
    text = decodeURIComponent(text);
  } catch {
    // kept as written
  }
  // placeholders alone (`?query=${q}`, `?query=${a} ${b}`) are values the scan does not know, not a document selecting `q`
  return text.replace(/\{[\w.:-]+\}/g, "").includes("{") ? { type: "string", enum: [text] } : undefined;
}

/** `GET /graphql?query=...&operationName=...`, or a persisted query sent in the URL. */
function queryOperations(r: ResolvedCall): Operation[] {
  const shape = { ...r.url.queryShape, ...r.query.shape };
  const names = new Set([...r.url.query, ...r.query.names]);
  if (!names.has("query") && !names.has("extensions")) return [];
  const hinted = names.has("operationName") || names.has("variables") || GRAPHQL_PATH.test(r.url.pathTemplate);
  const query = names.has("query") ? (urlDocument(r.url.raw) ?? shape.query ?? { type: "string" }) : undefined;
  return envelopeOperations({ query, operationName: shape.operationName, hinted, persisted: names.has("extensions") && hinted }, "query");
}

/**
 * A document argument: the document itself, or the options holding it (Octokit `graphql({ query })`, Apollo
 * `client.mutate({ mutation })`, Relay `requestSubscription(env, { subscription })`, graphql-request `request({ document })`).
 */
function documentEnvelope(d: Shape): Envelope {
  if (d.type !== "object") return { query: d, hinted: true, persisted: false };
  const { query, mutation, subscription, document } = d.properties;
  return bodyEnvelope({ ...d, properties: { ...d.properties, query: query ?? mutation ?? subscription ?? document ?? { type: "unknown" } } }, "graphql");
}

/**
 * The operations a request sends. An SDK method that takes a document (Octokit `graphql()`) gives it apart from the
 * body; a document holding several operations with no `operationName` that picks one gives each of them.
 */
export function graphqlOperations(r: ResolvedCall): Operation[] {
  if (r.document) {
    const ops = envelopeOperations(documentEnvelope(r.document), "document");
    // the method sends a GraphQL operation whatever the scan could read of its document
    return ops.length > 0 ? distinct(ops) : [graphql(null, "document")];
  }
  if (r.client === "sdk") return [];
  const fromBody = bodyOperations(r);
  return distinct(fromBody.length > 0 ? fromBody : queryOperations(r));
}
