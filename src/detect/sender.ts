import { Node, SyntaxKind, type CallExpression, type Expression, type VariableDeclaration } from "ts-morph";
import { declarationsOf } from "../ast/object.js";
import type { MethodSpec, RawCall } from "../types.js";

type SendsThrough = NonNullable<MethodSpec["sendsThrough"]>;

/** The declaration a hook's result is destructured into (`const [ref, loadQuery] = useQueryLoader(Q)`), if any. */
function resultDeclaration(node: CallExpression): VariableDeclaration | Node | undefined {
  let p = node.getParent();
  while (p && (Node.isAwaitExpression(p) || Node.isParenthesizedExpression(p) || Node.isAsExpression(p) || Node.isNonNullExpression(p))) p = p.getParent();
  return p;
}

/**
 * Whether the code keeps the function a hook sends through: `const [ref, loadQuery] = useQueryLoader(Q)` does,
 * `const { data } = usePaginationFragment(F, key)` and a result left unused do not.
 */
export function keepsSender(node: CallExpression, through: SendsThrough): boolean {
  const p = resultDeclaration(node);
  if (!p || Node.isExpressionStatement(p)) return false;
  if (!Node.isVariableDeclaration(p)) return true;
  const name = p.getNameNode();
  if (Node.isArrayBindingPattern(name)) {
    const el = through.index !== undefined ? name.getElements()[through.index] : undefined;
    return !!el && !Node.isOmittedExpression(el);
  }
  if (!Node.isObjectBindingPattern(name)) return true;
  return name.getElements().some((el) => !!el.getDotDotDotToken() || (through.names ?? []).includes((el.getPropertyNameNode() ?? el.getNameNode()).getText()));
}

/**
 * Argument `bodyArg` of each call the code makes of the function a hook returns, in the function the hook is called
 * in (`loadQuery({ id })` after `const [ref, loadQuery] = useQueryLoader(Q)`, #102); none when it is handed on.
 */
function senderArgs(node: CallExpression, through: SendsThrough): Expression[] {
  const p = resultDeclaration(node);
  const name = p && Node.isVariableDeclaration(p) ? p.getNameNode() : undefined;
  const el = name && Node.isArrayBindingPattern(name) && through.index !== undefined ? name.getElements()[through.index] : undefined;
  const id = el && Node.isBindingElement(el) ? el.getNameNode() : undefined;
  if (!id || !Node.isIdentifier(id) || through.bodyArg === undefined) return [];
  const scope = node.getFirstAncestor((a) => Node.isFunctionLikeDeclaration(a)) ?? node.getSourceFile();
  const text = id.getText();
  const args = new Map<string, Expression>();
  for (const call of scope.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isIdentifier(callee) || callee.getText() !== text || declarationsOf(callee)[0] !== el) continue;
    const arg = call.getArguments()[through.bodyArg] as Expression | undefined;
    if (arg) args.set(arg.getText(), arg);
  }
  return [...args.values()];
}

/** The body of a hook's request: the variables the function it returns is given, one value or several. */
export function withSenderArgs(raw: RawCall, node: CallExpression, through: SendsThrough): RawCall {
  const args = senderArgs(node, through);
  if (args.length === 1) return { ...raw, bodyExpr: args[0] };
  return args.length > 1 ? { ...raw, bodyAlternatives: args } : raw;
}
