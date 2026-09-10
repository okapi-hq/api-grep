import { Node, type ParameterDeclaration } from "ts-morph";
import type { Callee } from "../types.js";

export type FunctionLike = Node & { getParameters(): ParameterDeclaration[]; getBody?(): Node | undefined };

export function isFunctionLike(n: Node | undefined): n is FunctionLike {
  return !!n && (Node.isFunctionDeclaration(n) || Node.isMethodDeclaration(n) || Node.isArrowFunction(n) || Node.isFunctionExpression(n));
}

/** The function a call resolves to: a local function, or a method of a local class (`svc.post`, `Svc.post`). */
export function wrapperFunction(callee: Callee): FunctionLike | undefined {
  const d = callee.localDecl;
  if (isFunctionLike(d) && callee.chain.length === 0) return d;
  if (d && (Node.isClassDeclaration(d) || Node.isClassExpression(d)) && callee.chain.length === 1) {
    const m = d.getMethod(callee.chain[0]!);
    return m && isFunctionLike(m) ? m : undefined;
  }
  return undefined;
}
