import { Node, type Expression, type ObjectLiteralExpression } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import { declarationsOf, getProp, importedVariable } from "../ast/object.js";
import { MAX_DOCUMENT_CHARS } from "../operation/graphql-document.js";
import type { Part } from "../types.js";
import { truncated } from "./graphql-source.js";

/**
 * Relay's compiled artifacts (#67, `__generated__/AppQuery.graphql.ts`): `{ kind: "Request", params: { name,
 * operationKind, text, id } }`, written by the compiler as a literal or as a function called in place that returns it.
 * The document is `params.text`; a persisted query (`text: null`, an `id`) is named by its header alone, its fields
 * unknown, as a document past its bound.
 */

const REQUEST_KINDS = new Set(["Request", "PreloadableConcreteRequest"]);
const OPERATION_KINDS = new Set(["query", "mutation", "subscription"]);
const NAME = /^[_A-Za-z][_0-9A-Za-z]*$/;
/** Variables and calls followed to the artifact's literal. */
const MAX_HOPS = 4;

function stringOf(e: Expression | undefined): string | undefined {
  const u = e && unwrap(e);
  return u && (Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u)) ? u.getLiteralValue() : undefined;
}

const isRequest = (o: ObjectLiteralExpression): boolean => REQUEST_KINDS.has(stringOf(getProp(o, "kind")) ?? "") && !!getProp(o, "params");

/** `(function () { var v0 = [...]; return { ... }; })()`: what the function called in place returns. */
function returnedByIife(u: Expression): Expression | undefined {
  if (!Node.isCallExpression(u) || u.getArguments().length > 0) return undefined;
  const fn = unwrap(u.getExpression());
  if (!Node.isFunctionExpression(fn) && !Node.isArrowFunction(fn)) return undefined;
  const body = fn.getBody();
  if (!Node.isBlock(body)) return Node.isExpression(body) ? body : undefined;
  const ret = body.getStatements().find((s) => Node.isReturnStatement(s));
  return ret && Node.isReturnStatement(ret) ? ret.getExpression() : undefined;
}

/** The artifact literal an expression names: written here, or a constant (imported or not) holding one. */
function requestLiteral(e: Expression, hops: number): ObjectLiteralExpression | undefined {
  if (hops > MAX_HOPS) return undefined;
  const u = unwrap(e);
  if (Node.isObjectLiteralExpression(u)) return isRequest(u) ? u : undefined;
  if (Node.isIdentifier(u)) {
    const decl = declarationsOf(u).find((d) => Node.isVariableDeclaration(d)) ?? importedVariable(u);
    const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
    return init ? requestLiteral(init, hops + 1) : undefined;
  }
  const returned = returnedByIife(u);
  return returned ? requestLiteral(returned, hops + 1) : undefined;
}

/** The document a Relay artifact sends; undefined when `e` names none. */
export function relayDocument(e: Expression): Part[] | undefined {
  const artifact = requestLiteral(e, 0);
  const params = artifact && getProp(artifact, "params");
  if (!params) return undefined;
  const text = stringOf(getProp(params, "text"));
  if (text !== undefined) return text.length > MAX_DOCUMENT_CHARS ? truncated(text) : [{ kind: "static", text, viaConst: true }];
  const name = stringOf(getProp(params, "name"));
  const kind = stringOf(getProp(params, "operationKind"));
  return name && NAME.test(name) && kind && OPERATION_KINDS.has(kind) ? truncated(`${kind} ${name} `) : undefined;
}
