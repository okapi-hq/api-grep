import { Node, SyntaxKind, type Expression, type ParameterDeclaration } from "ts-morph";

export type FunctionLike = Node & { getParameters(): ParameterDeclaration[]; getBody?(): Node | undefined };

export function isFunctionLike(n: Node | undefined): n is FunctionLike {
  return !!n && (Node.isFunctionDeclaration(n) || Node.isMethodDeclaration(n) || Node.isArrowFunction(n) || Node.isFunctionExpression(n));
}

/** Returns per function, read once: a service factory's body can be thousands of lines, asked about at every use. */
const ownReturns = new WeakMap<Node, Expression[]>();
const allReturns = new WeakMap<Node, Expression[]>();

/** What a function returns: an arrow's expression body, else the expressions of its own `return` statements. */
export function returnsOf(fn: FunctionLike): Expression[] {
  let found = ownReturns.get(fn);
  if (!found) {
    const own = (r: Node): boolean => r.getFirstAncestor((a) => isFunctionLike(a)) === fn;
    found = returnStatements(fn).flatMap((r) => (own(r) ? [r] : []));
    ownReturns.set(fn, found);
  }
  return found;
}

/** The expressions of every `return` in a function's body, nested functions' included; an arrow's expression body. */
export function nestedReturnsOf(fn: FunctionLike): Expression[] {
  let found = allReturns.get(fn);
  if (!found) allReturns.set(fn, (found = returnStatements(fn)));
  return found;
}

function returnStatements(fn: FunctionLike): Expression[] {
  const body = fn.getBody?.();
  if (!body) return [];
  if (Node.isExpression(body)) return [body];
  return body.getDescendantsOfKind(SyntaxKind.ReturnStatement).flatMap((r) => r.getExpression() ?? []);
}
