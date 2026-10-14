import { Kind, parse, print, type DocumentNode, type FragmentDefinitionNode, type OperationDefinitionNode, type SelectionSetNode } from "graphql";
import type { GraphqlLimit } from "./limits.js";

/**
 * A GraphQL document read without a schema (#35): each operation's type, name and the field paths it selects from the
 * root. The document comes from the scanned repository, so its size, the parser's work and the paths fragments expand
 * to are all bounded; past a bound the fields are left out rather than cut short, and the bound is named (#55).
 */

/** Characters of a document; generated documents of a large app stay well below. */
export const MAX_DOCUMENT_CHARS = 100_000;
/** Lexer tokens, so a document of nothing but punctuation cannot make the parser loop for long. */
const MAX_TOKENS = 50_000;
/** Distinct field paths of one operation. */
export const MAX_FIELDS = 2_000;
/** Selection sets visited while expanding fragments: a fragment spread twice per level doubles the work per level. */
const MAX_VISITS = 20_000;
/** Nesting of selection sets, fragments included. */
const MAX_DEPTH = 32;

export type OperationType = "query" | "mutation" | "subscription";

export interface DocumentOperation {
  type: OperationType;
  /** The operation's name; an anonymous operation is named by its root fields (`viewer`, `orders,shop`). */
  name: string;
  /** False for an operation without a name of its own. */
  named: boolean;
  /** Sorted leaf paths (`order.customer.email`); undefined when a bound was reached. */
  fields?: string[];
  /** The bound reached while reading the fields. */
  limit?: GraphqlLimit;
}

class Exhausted extends Error {
  constructor(readonly limit: GraphqlLimit) {
    super(limit);
  }
}

interface Walk {
  fragments: Map<string, FragmentDefinitionNode>;
  paths: Set<string>;
  visits: number;
}

function walk(set: SelectionSetNode, prefix: string, w: Walk, active: string[]): void {
  if (++w.visits > MAX_VISITS) throw new Exhausted("fragment-expansion");
  if (active.length > MAX_DEPTH) throw new Exhausted("depth");
  for (const sel of set.selections) {
    if (sel.kind === Kind.FIELD) {
      // an alias renames the result, not what is selected
      const path = prefix ? `${prefix}.${sel.name.value}` : sel.name.value;
      if (sel.selectionSet) walk(sel.selectionSet, path, w, [...active, ""]);
      else w.paths.add(path);
    } else if (sel.kind === Kind.INLINE_FRAGMENT) {
      walk(sel.selectionSet, prefix, w, [...active, ""]);
    } else {
      const name = sel.name.value;
      const fragment = w.fragments.get(name);
      // a fragment defined elsewhere (or spread inside itself) still selects the field it sits on
      if (!fragment || active.includes(name)) {
        if (prefix) w.paths.add(prefix);
        continue;
      }
      walk(fragment.selectionSet, prefix, w, [...active, name]);
    }
    if (w.paths.size > MAX_FIELDS) throw new Exhausted("fields");
  }
}

/** The leaf paths an operation selects, sorted; the bound instead, past one. */
function fieldsOf(op: OperationDefinitionNode, fragments: Map<string, FragmentDefinitionNode>): string[] | GraphqlLimit {
  const w: Walk = { fragments, paths: new Set(), visits: 0 };
  try {
    walk(op.selectionSet, "", w, []);
  } catch (err) {
    if (err instanceof Exhausted) return err.limit;
    throw err;
  }
  return [...w.paths].sort();
}

function rootFields(fields: string[] | undefined, op: OperationDefinitionNode): string {
  const roots = fields ? fields.map((f) => f.split(".")[0]!) : op.selectionSet.selections.flatMap((s) => (s.kind === Kind.FIELD ? [s.name.value] : []));
  return [...new Set(roots)].sort().join(",");
}

/** graphql-js's message when `maxTokens` stops the parser ("Document contains more that 50000 tokens", sic). */
const TOO_MANY_TOKENS = /contains more th(?:at|an) \d+ tokens/;

/** The document, or the bound that stopped its parsing; neither when it is not GraphQL. */
function parsedOrLimit(text: string): DocumentNode | GraphqlLimit | undefined {
  if (text.length > MAX_DOCUMENT_CHARS) return "document-size";
  try {
    return parse(text, { noLocation: true, maxTokens: MAX_TOKENS });
  } catch (err) {
    return err instanceof Error && TOO_MANY_TOKENS.test(err.message) ? "tokens" : undefined;
  }
}

function parsed(text: string): DocumentNode | undefined {
  const doc = parsedOrLimit(text);
  return typeof doc === "object" ? doc : undefined;
}

function operationOf(op: OperationDefinitionNode, fragments: Map<string, FragmentDefinitionNode>): DocumentOperation {
  const read = fieldsOf(op, fragments);
  const fields = typeof read === "string" ? undefined : read;
  const name = op.name?.value;
  return { type: op.operation, name: name ?? rootFields(fields, op), named: !!name, ...(typeof read === "string" ? { limit: read } : { fields: read }) };
}

/**
 * The operations of a document, in document order, or the bound past which it was not parsed. `operations` is
 * undefined when the text is not a GraphQL document with one.
 */
export function readDocument(text: string): { operations?: DocumentOperation[]; limit?: GraphqlLimit } {
  const doc = parsedOrLimit(text);
  if (typeof doc !== "object") return doc ? { limit: doc } : {};
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const d of doc.definitions) if (d.kind === Kind.FRAGMENT_DEFINITION) fragments.set(d.name.value, d);
  const ops = doc.definitions.filter((d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION);
  return ops.length === 0 ? {} : { operations: ops.map((op) => operationOf(op, fragments)) };
}

/** The operations of a document, in document order; undefined when the text is not a GraphQL document with one. */
export const documentOperations = (text: string): DocumentOperation[] | undefined => readDocument(text).operations;

const HEADER = /^\s*(query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/;

/**
 * The type and name a document starts with, when it cannot be parsed as a whole: too large, or built with computed
 * parts (`user(id: ${id})`). Its fields are unknown.
 */
export function documentHeader(text: string): { type: OperationType; name: string } | undefined {
  const m = HEADER.exec(text.slice(0, 1_000).replace(/^\s*#[^\n]*\n/gm, ""));
  return m ? { type: m[1] as OperationType, name: m[2]! } : undefined;
}

/** The document of one named operation of `text`, with every fragment of `text`; undefined when it has no such operation. */
export function operationDocument(text: string, name: string): string | undefined {
  const doc = parsed(text);
  const keep = doc?.definitions.filter((d) => d.kind === Kind.FRAGMENT_DEFINITION || (d.kind === Kind.OPERATION_DEFINITION && d.name?.value === name));
  if (!doc || !keep?.some((d) => d.kind === Kind.OPERATION_DEFINITION)) return undefined;
  return print({ ...doc, definitions: keep });
}

/** The text of a document given as its AST (#56); undefined when `print` cannot read it as one. */
export function printedDocument(doc: { kind: "Document"; definitions: unknown[] }): string | undefined {
  try {
    return print(doc as unknown as DocumentNode);
  } catch {
    return undefined;
  }
}
