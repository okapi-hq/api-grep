import { Node, type ParameterDeclaration } from "ts-morph";

export type FunctionLike = Node & { getParameters(): ParameterDeclaration[]; getBody?(): Node | undefined };

export function isFunctionLike(n: Node | undefined): n is FunctionLike {
  return !!n && (Node.isFunctionDeclaration(n) || Node.isMethodDeclaration(n) || Node.isArrowFunction(n) || Node.isFunctionExpression(n));
}
