import { Node, SyntaxKind, type CallExpression, type Expression, type PropertyAccessExpression } from "ts-morph";
import { enclosingClass } from "../ast/class.js";
import { unwrap } from "../ast/expr.js";
import { isFunctionLike, type FunctionLike } from "../ast/function.js";
import { declarationsOf, toObjectLiteral } from "../ast/object.js";
import type { EvalCtx, Subst } from "../types.js";

/** Declarations behind a callee, through an import (`import { apiUrl } from "./urls"`) to the project file defining it. */
function calleeDeclarations(callee: Expression): Node[] {
  const sym = callee.getSymbol();
  if (!sym?.isAlias()) return declarationsOf(callee);
  return (sym.getAliasedSymbol()?.getDeclarations() ?? []).filter((d) => !d.getSourceFile().isFromExternalLibrary());
}

/** The project function an identifier names: a declaration or an arrow constant, imported or not. */
function functionNamed(ident: Expression): FunctionLike | undefined {
  for (const decl of calleeDeclarations(ident)) {
    if (isFunctionLike(decl)) return decl;
    const init = Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
    const u = init ? unwrap(init) : undefined;
    if (isFunctionLike(u)) return u;
  }
  return undefined;
}

/** The project function a call runs, and where its arguments start: `apiUrl(m)`, `this.url(p)`, `getBaseUrl.call(this, p)`. */
function calledFunction(call: CallExpression): { fn: FunctionLike; shift: number } | undefined {
  const callee = unwrap(call.getExpression());
  if (Node.isIdentifier(callee)) {
    const fn = functionNamed(callee);
    return fn ? { fn, shift: 0 } : undefined;
  }
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  if (Node.isThisExpression(callee.getExpression())) {
    const method = enclosingClass(callee)?.getMethod(callee.getName());
    return isFunctionLike(method) ? { fn: method, shift: 0 } : undefined;
  }
  // `fn.call(this, ...)`: the arguments after `this`
  const fn = callee.getName() === "call" && Node.isIdentifier(callee.getExpression()) ? functionNamed(callee.getExpression()) : undefined;
  if (fn) return { fn, shift: 1 };
  const method = objectMethod(callee);
  return method ? { fn: method, shift: 0 } : undefined;
}

/** `common.getApiUrl(env)`: a method (or arrow property) of a project object literal, imported or not. */
function objectMethod(callee: PropertyAccessExpression): FunctionLike | undefined {
  const member = toObjectLiteral(callee.getExpression())?.getProperty(callee.getName());
  if (isFunctionLike(member)) return member;
  const init = Node.isPropertyAssignment(member) ? member.getInitializer() : undefined;
  const u = init ? unwrap(init) : undefined;
  return isFunctionLike(u) ? u : undefined;
}

/** What a function returns: its expression body, or its own `return`s in order (nested functions aside). */
function returnedExprs(fn: FunctionLike): Expression[] {
  const body = fn.getBody?.();
  if (!body) return [];
  if (Node.isExpression(body)) return [body];
  return body
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .filter((r) => r.getFirstAncestor((a) => isFunctionLike(a)) === fn)
    .flatMap((r) => r.getExpression() ?? []);
}

/**
 * A call to a project helper that builds a URL (`const apiUrl = (m) => \`https://api.telegram.org/bot${t}/${m}\``):
 * the expressions it returns, with the call's arguments substituted for its parameters (one level, like wrappers).
 */
export function localReturn(call: Expression, ctx: EvalCtx): { exprs: Expression[]; ctx: EvalCtx } | undefined {
  if (!Node.isCallExpression(call)) return undefined;
  const target = calledFunction(call);
  if (!target || target.fn.getSourceFile().isDeclarationFile()) return undefined;
  const exprs = returnedExprs(target.fn);
  if (exprs.length === 0) return undefined;
  const subst: Subst = new Map(ctx.subst ?? []);
  const args = (call.getArguments() as Expression[]).slice(target.shift);
  target.fn
    .getParameters()
    .filter((p) => p.getName() !== "this")
    .forEach((p, i) => {
      const arg = args[i];
      if (arg && !p.isRestParameter()) subst.set(p, arg);
    });
  return { exprs, ctx: { ...ctx, subst } };
}
