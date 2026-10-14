import { Node, type CallExpression, type Expression } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import { declarationsOf, getProp, toObjectLiteral } from "../ast/object.js";
import { memoized } from "../ast/react.js";
import { contextValues } from "./react-context.js";

/**
 * Clients handed out by React hooks (#98): `useMemo(() => client, deps)` returns what its function returns,
 * `useContext(RpcContext)` the values of the app's provider elements; the object such a value often is holds the client
 * under the name the caller reads (`const { provider } = useContext(RpcContext)`).
 */

const MAX_DEPTH = 6;

/** The values a hook call hands out; undefined for any other call. */
export function hookValues(call: CallExpression): Expression[] | undefined {
  return memoized(call) ?? contextValues(call);
}

/** A value and the members read from it, stepped into the objects that hold them: `{ provider }` then `provider.getBlock`. */
export function heldValue(value: Expression, chain: string[], depth = 0): { value: Expression; chain: string[] } {
  if (chain.length < 2 || depth > MAX_DEPTH) return { value, chain };
  const lit = toObjectLiteral(value);
  const inner = lit ? getProp(lit, chain[0]!) : undefined;
  return inner ? heldValue(inner, chain.slice(1), depth + 1) : { value, chain };
}

/**
 * The identifier a value names, as declared: a shorthand property (`{ provider }`) names the variable, whose own name
 * node resolves to it.
 */
export function namedValue(value: Expression): Expression | undefined {
  const u = unwrap(value);
  if (!Node.isIdentifier(u)) return undefined;
  if (!Node.isShorthandPropertyAssignment(u.getParent())) return u;
  const decl = declarationsOf(u)[0];
  const name = decl && (Node.isVariableDeclaration(decl) || Node.isBindingElement(decl) || Node.isParameterDeclaration(decl)) ? decl.getNameNode() : undefined;
  return name && Node.isIdentifier(name) ? name : undefined;
}
