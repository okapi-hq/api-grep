import { Node, SyntaxKind, type Expression, type ParameterDeclaration } from "ts-morph";

export type FunctionLike = Node & { getParameters(): ParameterDeclaration[]; getBody?(): Node | undefined };

export function isFunctionLike(n: Node | undefined): n is FunctionLike {
  return !!n && (Node.isFunctionDeclaration(n) || Node.isMethodDeclaration(n) || Node.isArrowFunction(n) || Node.isFunctionExpression(n));
}

/** What a function returns: an arrow's expression body, else the expressions of its own `return` statements. */
export function returnsOf(fn: FunctionLike): Expression[] {
  const body = fn.getBody?.();
  if (!body) return [];
  if (Node.isExpression(body)) return [body];
  const own = (r: Node): boolean => r.getFirstAncestor((a) => isFunctionLike(a)) === fn;
  return body.getDescendantsOfKind(SyntaxKind.ReturnStatement).flatMap((r) => (own(r) && r.getExpression() ? [r.getExpression()!] : []));
}
