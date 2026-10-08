import { Node, SyntaxKind, type CallExpression, type Expression } from "ts-morph";
import { unwrap } from "../detect/callee.js";
import { declarationsOf } from "../detect/options.js";
import type { EvalCtx, Subst } from "../types.js";
import { isFunctionLike, type FunctionLike } from "../wrappers/function.js";

/** The project function a call runs: `apiUrl(m)` (declaration or arrow constant) or `this.url(p)` (a method). */
function calledFunction(call: CallExpression): FunctionLike | undefined {
  const callee = unwrap(call.getExpression() as Expression);
  if (Node.isIdentifier(callee)) {
    for (const decl of declarationsOf(callee)) {
      if (isFunctionLike(decl)) return decl;
      const init = Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
      const u = init ? unwrap(init) : undefined;
      if (isFunctionLike(u)) return u;
    }
    return undefined;
  }
  if (Node.isPropertyAccessExpression(callee) && Node.isThisExpression(callee.getExpression())) {
    const cls = callee.getFirstAncestorByKind(SyntaxKind.ClassDeclaration) ?? callee.getFirstAncestorByKind(SyntaxKind.ClassExpression);
    const method = cls?.getMethod(callee.getName());
    return isFunctionLike(method) ? method : undefined;
  }
  return undefined;
}

/** The one value a function returns: its expression body, or its only `return` (nested functions aside). */
function returnedExpr(fn: FunctionLike): Expression | undefined {
  const body = fn.getBody?.();
  if (!body) return undefined;
  if (Node.isExpression(body)) return body;
  const returns = body.getDescendantsOfKind(SyntaxKind.ReturnStatement).filter((r) => r.getFirstAncestor((a) => isFunctionLike(a)) === fn);
  return returns.length === 1 ? returns[0]!.getExpression() : undefined;
}

/**
 * A call to a local helper that builds a URL (`const apiUrl = (m) => \`https://api.telegram.org/bot${t}/${m}\``):
 * the expression it returns, with the call's arguments substituted for its parameters (one level, like wrappers).
 */
export function localReturn(call: Expression, ctx: EvalCtx): { expr: Expression; ctx: EvalCtx } | undefined {
  if (!Node.isCallExpression(call)) return undefined;
  const fn = calledFunction(call);
  if (!fn || fn.getSourceFile().isDeclarationFile()) return undefined;
  const expr = returnedExpr(fn);
  if (!expr) return undefined;
  const subst: Subst = new Map(ctx.subst ?? []);
  const args = call.getArguments() as Expression[];
  fn.getParameters()
    .filter((p) => p.getName() !== "this")
    .forEach((p, i) => {
      const arg = args[i];
      if (arg && !p.isRestParameter()) subst.set(p, arg);
    });
  return { expr, ctx: { ...ctx, subst } };
}
