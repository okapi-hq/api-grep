import { Node, SyntaxKind, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import type { Callee, EvalCtx, RawCall } from "../types.js";
import { memberChain, unwrap } from "./callee.js";

/** The calls made on the same request object in the function (`xhr.open(...)`, `xhr.setRequestHeader(...)`). */
function siblingCalls(node: CallExpression, target: string, name: string): CallExpression[] {
  const scope = node.getFirstAncestor((a) => Node.isFunctionLikeDeclaration(a)) ?? node.getSourceFile();
  return scope.getDescendantsOfKind(SyntaxKind.CallExpression).filter((c) => {
    const e = unwrap(c.getExpression() as Expression);
    return Node.isPropertyAccessExpression(e) && e.getName() === name && unwrap(e.getExpression()).getText() === target;
  });
}

/**
 * `const xhr = new XMLHttpRequest(); xhr.open("POST", url); xhr.setRequestHeader(...); xhr.send(body)`: one request,
 * reported at `send`, with the method and URL of the `open` call before it.
 */
export function detectXhr(node: CallExpression | NewExpression, callee: Callee, _ctx: EvalCtx = {}): RawCall | null {
  if (!Node.isCallExpression(node) || callee.global !== "XMLHttpRequest" || !callee.instance || callee.chain.join(".") !== "send") return null;
  const target = memberChain(node.getExpression() as Expression).nodes.at(-2)?.getText();
  if (!target) return null;
  const open = siblingCalls(node, target, "open").filter((c) => c.getStart() < node.getStart()).pop();
  const [methodExpr, urlExpr] = (open?.getArguments() ?? []) as Expression[];
  const headerPairs = siblingCalls(node, target, "setRequestHeader").flatMap((c) => {
    const [k, v] = c.getArguments() as Expression[];
    return k && v ? [[k, v] as [Expression, Expression]] : [];
  });
  return { node, client: "xhr", urlExpr, methodExpr, impliedMethod: methodExpr ? undefined : "GET", bodyExpr: (node.getArguments() as Expression[])[0], bodyKey: "body", headerPairs };
}
