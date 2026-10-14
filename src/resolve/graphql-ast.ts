import { Node, ts, type Expression, type ObjectLiteralExpression } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import { declarationsOf, importedVariable } from "../ast/object.js";
import { MAX_DOCUMENT_CHARS, printedDocument } from "../operation/graphql-document.js";
import type { GraphqlLimit } from "../operation/limits.js";
import { isSafeKey } from "../record-keys.js";
import type { Part } from "../types.js";
import { truncated } from "./graphql-source.js";

/**
 * GraphQL documents written as their parsed AST (#56): graphql-codegen's typed-document-node output and client preset
 * (`export const GetOrderDocument = {"kind":"Document","definitions":[...]} as unknown as DocumentNode<...>`) and
 * graphql-tag documents precompiled by a Babel plugin. Each reads as the text it prints to, which is then bounded and
 * parsed like a document written as text. The literal comes from a hostile repository: it is read only while it stays
 * JSON-like (no reference, call or spread inside a definition), within a budget of nodes and nesting.
 */

/** Objects, arrays and literals read from one document: an AST takes about five per selected field. */
const MAX_NODES = 200_000;
/** Nesting of objects and arrays: about three per level of selection sets. */
const MAX_NESTING = 128;
/** Characters of the literal, checked before anything is read. */
const MAX_CHARS = 4_000_000;
/** `...OtherDocument.definitions` followed this many documents deep (codegen's fragment documents). */
const MAX_SPREAD_DEPTH = 4;

type Plain = string | number | boolean | null | Plain[] | { [key: string]: Plain };

/** Past a bound (named), or something in a definition is not a literal. */
class Unreadable extends Error {
  constructor(readonly limit?: GraphqlLimit) {
    super(limit ?? "not a literal");
  }
}

interface Read {
  nodes: number;
  /** Documents whose definitions are spread in, so one spread into itself is read once. */
  seen: Set<ObjectLiteralExpression>;
}

function keyOf(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) ? name.text : undefined;
}

function skipCasts(e: ts.Expression): ts.Expression {
  let cur = e;
  while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isTypeAssertionExpression(cur) || ts.isNonNullExpression(cur)) cur = cur.expression;
  return cur;
}

function property(obj: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
  for (const p of obj.properties) if (ts.isPropertyAssignment(p) && keyOf(p.name) === key) return p.initializer;
  return undefined;
}

function stringOf(e: ts.Expression | undefined): string | undefined {
  const u = e && skipCasts(e);
  return u && (ts.isStringLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u)) ? u.text : undefined;
}

/** The value of a JSON-like literal; undefined when anything in it is not a literal (a reference, a call, a spread). */
function plain(e: ts.Expression, r: Read, nesting: number): Plain | undefined {
  if (++r.nodes > MAX_NODES) throw new Unreadable("ast-nodes");
  if (nesting > MAX_NESTING) throw new Unreadable("ast-nesting");
  const u = skipCasts(e);
  if (ts.isStringLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u)) return u.text;
  if (ts.isNumericLiteral(u)) return Number(u.text);
  if (u.kind === ts.SyntaxKind.TrueKeyword || u.kind === ts.SyntaxKind.FalseKeyword) return u.kind === ts.SyntaxKind.TrueKeyword;
  if (u.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(u)) {
    const out: Plain[] = [];
    for (const el of u.elements) {
      const v = plain(el, r, nesting + 1);
      if (v === undefined) return undefined;
      out.push(v);
    }
    return out;
  }
  if (!ts.isObjectLiteralExpression(u)) return undefined;
  const out: Record<string, Plain> = {};
  for (const p of u.properties) {
    const key = ts.isPropertyAssignment(p) ? keyOf(p.name) : undefined;
    const v = key !== undefined && ts.isPropertyAssignment(p) ? plain(p.initializer, r, nesting + 1) : undefined;
    if (v === undefined) return undefined;
    if (isSafeKey(key!)) out[key!] = v;
  }
  return out;
}

/** An object literal shaped like a `DocumentNode`: `kind: "Document"` and its `definitions`. */
export function isAstDocument(u: Expression): u is ObjectLiteralExpression {
  if (!Node.isObjectLiteralExpression(u)) return false;
  return stringOf(property(u.compilerNode, "kind")) === "Document" && property(u.compilerNode, "definitions") !== undefined;
}

/** The document literal an expression names: the literal itself, or a constant (imported or not) holding one. */
function documentLiteral(e: Expression): ObjectLiteralExpression | undefined {
  const u = unwrap(e);
  if (isAstDocument(u)) return u;
  if (!Node.isIdentifier(u)) return undefined;
  const decl = declarationsOf(u).find((d) => Node.isVariableDeclaration(d)) ?? importedVariable(u);
  const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
  const v = init && unwrap(init);
  return v && isAstDocument(v) ? v : undefined;
}

/**
 * The definitions an element of `definitions` stands for: a definition, or the definitions of another document spread
 * in (`...FragmentDoc.definitions`, `[op].concat(FragmentDoc.definitions)`). A document the scan cannot find is left
 * out: a spread of a fragment it defined then selects the field it sits on.
 */
function definitionsFrom(e: Expression, r: Read, depth: number): Plain[] {
  const u = unwrap(e);
  if (Node.isSpreadElement(u)) return definitionsFrom(u.getExpression(), r, depth);
  if (Node.isArrayLiteralExpression(u)) return u.getElements().flatMap((el) => definitionsFrom(el, r, depth));
  if (Node.isPropertyAccessExpression(u) && u.getName() === "definitions") {
    const doc = depth < MAX_SPREAD_DEPTH ? documentLiteral(u.getExpression()) : undefined;
    return doc ? (definitionsOf(doc, r, depth + 1) ?? []) : [];
  }
  const v = plain(u.compilerNode, r, 0);
  if (v === undefined) throw new Unreadable();
  return [v];
}

function definitionsOf(doc: ObjectLiteralExpression, r: Read, depth: number): Plain[] | undefined {
  if (r.seen.has(doc)) return [];
  r.seen.add(doc);
  const init = doc.getProperties().find((p) => Node.isPropertyAssignment(p) && keyOf(p.compilerNode.name) === "definitions");
  const value = init && Node.isPropertyAssignment(init) ? init.getInitializer() : undefined;
  const list = value && unwrap(value);
  if (!list) return undefined;
  if (Node.isArrayLiteralExpression(list)) return definitionsFrom(list, r, depth);
  // `[op].concat(FragmentDoc.definitions, ...)`
  const callee = Node.isCallExpression(list) ? unwrap(list.getExpression()) : undefined;
  if (!Node.isCallExpression(list) || !callee || !Node.isPropertyAccessExpression(callee) || callee.getName() !== "concat") return undefined;
  return [callee.getExpression(), ...(list.getArguments() as Expression[])].flatMap((a) => definitionsFrom(a, r, depth));
}

/** `query GetOrder`: the header of a document too large to read, so it is named like a text document past its bound. */
function header(doc: ObjectLiteralExpression, limit?: GraphqlLimit): Part[] {
  const list = property(doc.compilerNode, "definitions");
  const items = list && ts.isArrayLiteralExpression(skipCasts(list)) ? (skipCasts(list) as ts.ArrayLiteralExpression).elements : [];
  const first = items.map(skipCasts).find((d): d is ts.ObjectLiteralExpression => ts.isObjectLiteralExpression(d) && stringOf(property(d, "kind")) === "OperationDefinition");
  const type = first && stringOf(property(first, "operation"));
  const nameNode = first && property(first, "name");
  const name = nameNode && ts.isObjectLiteralExpression(skipCasts(nameNode)) ? stringOf(property(skipCasts(nameNode) as ts.ObjectLiteralExpression, "value")) : undefined;
  const start = type && name ? `${type} ${name} ` : "";
  return truncated(start, limit);
}

function readDocument(doc: ObjectLiteralExpression): Part[] {
  if (doc.getEnd() - doc.getStart() > MAX_CHARS) return header(doc, "ast-size");
  let definitions: Plain[] | undefined;
  try {
    definitions = definitionsOf(doc, { nodes: 0, seen: new Set() }, 0);
  } catch (err) {
    if (err instanceof Unreadable) return header(doc, err.limit);
    throw err;
  }
  const text = definitions && printedDocument({ kind: "Document", definitions });
  if (text === undefined) return header(doc);
  return text.length > MAX_DOCUMENT_CHARS ? truncated(text, "document-size") : [{ kind: "static", text, viaConst: true }];
}

/** Documents already read: codegen's documents are imported by many files. */
const memo = new WeakMap<ts.Node, Part[]>();

/** The text of a document written as an AST object literal; undefined when `u` is not one. */
export function astDocumentParts(u: Expression): Part[] | undefined {
  if (!isAstDocument(u)) return undefined;
  const known = memo.get(u.compilerNode);
  if (known) return known;
  const parts = readDocument(u);
  memo.set(u.compilerNode, parts);
  return parts;
}
