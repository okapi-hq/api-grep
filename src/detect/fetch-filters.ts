import { Node, SyntaxKind, type CallExpression, type Expression } from "ts-morph";
import { evaluate } from "../resolve/evaluate.js";
import type { EvalCtx } from "../types.js";
import { isFunctionLike } from "../wrappers/function.js";
import { unwrap } from "./callee.js";
import { declarationsOf } from "./options.js";

const LOCAL_SCHEME = /^(?:data|blob):/i;
/** Calls that produce a `data:` / `blob:` URL from local content. */
const LOCAL_URL_MAKERS = new Set(["toDataURL", "createObjectURL", "readAsDataURL"]);
const GLOBAL_FETCH = /^(?:window|globalThis|self|global)\.fetch$/;

function makesLocalUrl(expr: Expression, depth: number): boolean {
  const u = unwrap(expr);
  if (depth > 3) return false;
  if (Node.isCallExpression(u)) {
    const callee = unwrap(u.getExpression() as Expression);
    const name = Node.isPropertyAccessExpression(callee) ? callee.getName() : callee.getText();
    return LOCAL_URL_MAKERS.has(name);
  }
  if (Node.isIdentifier(u)) {
    const decl = declarationsOf(u)[0];
    const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
    return !!init && makesLocalUrl(init, depth + 1);
  }
  return false;
}

/** `fetch("data:image/png;base64,...")`, `fetch(canvas.toDataURL())`, `fetch(URL.createObjectURL(file))`: no request leaves the process. */
export function readsLocalData(urlExpr: Expression | undefined, ctx: EvalCtx): boolean {
  if (!urlExpr) return false;
  const first = evaluate(urlExpr, ctx)[0];
  if (first?.kind === "static" && LOCAL_SCHEME.test(first.text)) return true;
  return makesLocalUrl(urlExpr, 0);
}

/** Inside `window.fetch = (input, init) => origFetch(input, init)`: the override forwards requests made elsewhere. */
export function insideFetchOverride(node: CallExpression): boolean {
  for (const fn of node.getAncestors().filter((a) => isFunctionLike(a))) {
    const parent = fn.getParent();
    if (Node.isBinaryExpression(parent) && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken && GLOBAL_FETCH.test(parent.getLeft().getText().replace(/\s/g, ""))) {
      return true;
    }
  }
  return false;
}
