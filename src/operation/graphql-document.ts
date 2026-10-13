import { Kind, parse, print, type DocumentNode, type FragmentDefinitionNode, type OperationDefinitionNode, type SelectionSetNode } from "graphql";

/**
 * A GraphQL document read without a schema (#35): each operation's type, name and the field paths it selects from the
 * root. The document comes from the scanned repository, so its size, the parser's work and the paths fragments expand
 * to are all bounded; past a bound the fields are left out rather than cut short.
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
}

class Exhausted extends Error {}

interface Walk {
  fragments: Map<string, FragmentDefinitionNode>;
  paths: Set<string>;
  visits: number;
}

function walk(set: SelectionSetNode, prefix: string, w: Walk, active: string[]): void {
  if (++w.visits > MAX_VISITS || active.length > MAX_DEPTH) throw new Exhausted();
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
    if (w.paths.size > MAX_FIELDS) throw new Exhausted();
  }
}

/** The leaf paths an operation selects, sorted; undefined past a bound. */
function fieldsOf(op: OperationDefinitionNode, fragments: Map<string, FragmentDefinitionNode>): string[] | undefined {
  const w: Walk = { fragments, paths: new Set(), visits: 0 };
  try {
    walk(op.selectionSet, "", w, []);
  } catch (err) {
    if (err instanceof Exhausted) return undefined;
    throw err;
  }
  return [...w.paths].sort();
}

function rootFields(fields: string[] | undefined, op: OperationDefinitionNode): string {
  const roots = fields ? fields.map((f) => f.split(".")[0]!) : op.selectionSet.selections.flatMap((s) => (s.kind === Kind.FIELD ? [s.name.value] : []));
  return [...new Set(roots)].sort().join(",");
}

function parsed(text: string): DocumentNode | undefined {
  if (text.length > MAX_DOCUMENT_CHARS) return undefined;
  try {
    return parse(text, { noLocation: true, maxTokens: MAX_TOKENS });
  } catch {
    return undefined;
  }
}

/** The operations of a document, in document order; undefined when the text is not a GraphQL document with one. */
export function documentOperations(text: string): DocumentOperation[] | undefined {
  const doc = parsed(text);
  if (!doc) return undefined;
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const d of doc.definitions) if (d.kind === Kind.FRAGMENT_DEFINITION) fragments.set(d.name.value, d);
  const ops = doc.definitions.filter((d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION);
  if (ops.length === 0) return undefined;
  return ops.map((op) => {
    const fields = fieldsOf(op, fragments);
    const name = op.name?.value;
    return { type: op.operation, name: name ?? rootFields(fields, op), named: !!name, ...(fields ? { fields } : {}) };
  });
}

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
