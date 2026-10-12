import { Node, SyntaxKind, type Expression, type IfStatement } from "ts-morph";
import { unwrap } from "../ast/expr.js";

/**
 * Keys added to or removed from an object after it is built (`params.k = v`, `params["k"] = v`,
 * `Object.assign(params, {...})`, `delete params.k`), in the function that declares it and before the use. Each edit
 * says whether it always runs before the use, runs in one branch of an `if` / `else` chain, or may not run.
 */

export type Reach = { kind: "always" } | { kind: "group"; group: number; branch: number; size: number } | { kind: "maybe" };

export type ObjectEdit =
  | { kind: "set"; key: string; value: Expression; node: Node }
  /** `Object.assign(params, value)`: every key of `value`. */
  | { kind: "merge"; value: Expression; node: Node }
  | { kind: "remove"; key: string; node: Node };

/** `params.k`, `params["k"]` on the variable: the key, else undefined. */
function keyOf(target: Node, isVar: (n: Node) => boolean): string | undefined {
  if (Node.isPropertyAccessExpression(target) && isVar(target.getExpression())) return target.getName();
  if (!Node.isElementAccessExpression(target) || !isVar(target.getExpression())) return undefined;
  const arg = target.getArgumentExpression();
  return arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) ? arg.getLiteralValue() : undefined;
}

function editOf(n: Node, isVar: (n: Node) => boolean): ObjectEdit | undefined {
  if (Node.isBinaryExpression(n) && n.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
    const key = keyOf(unwrap(n.getLeft()), isVar);
    return key !== undefined ? { kind: "set", key, value: n.getRight(), node: n } : undefined;
  }
  if (Node.isDeleteExpression(n)) {
    const key = keyOf(unwrap(n.getExpression()), isVar);
    return key !== undefined ? { kind: "remove", key, node: n } : undefined;
  }
  if (Node.isCallExpression(n) && n.getExpression().getText().replace(/\s/g, "") === "Object.assign") {
    const [target, ...sources] = n.getArguments() as Expression[];
    return target && isVar(unwrap(target)) && sources.length === 1 ? { kind: "merge", value: sources[0]!, node: n } : undefined;
  }
  return undefined;
}

const scopeOf = (n: Node): Node | undefined => n.getFirstAncestor((a) => Node.isFunctionLikeDeclaration(a) || Node.isSourceFile(a));

const cache = new WeakMap<Node, ObjectEdit[]>();

/** Every edit of the variable declared by `decl` in the function that declares it (nested functions aside). */
function editsInScope(decl: Node): ObjectEdit[] {
  const hit = cache.get(decl);
  if (hit) return hit;
  const scope = scopeOf(decl);
  const name = Node.isVariableDeclaration(decl) ? decl.getName() : undefined;
  const symbol = Node.isVariableDeclaration(decl) ? decl.getSymbol() : undefined;
  const isVar = (n: Node): boolean => Node.isIdentifier(n) && n.getText() === name && n.getSymbol() === symbol;
  const edits: ObjectEdit[] = [];
  if (scope && name && symbol) {
    for (const n of scope.getDescendants()) {
      const edit = n.getStart() >= decl.getEnd() ? editOf(n, isVar) : undefined;
      if (edit && scopeOf(n) === scope) edits.push(edit);
    }
  }
  cache.set(decl, edits);
  return edits;
}

/** The edits made to the variable of `decl` before `use`, in order. */
export function editsBefore(decl: Node, use: Node): ObjectEdit[] {
  return editsInScope(decl).filter((e) => e.node.getEnd() <= use.getStart());
}

const contains = (a: Node, b: Node): boolean => a.getStart() <= b.getStart() && b.getEnd() <= a.getEnd();

/** The `if` an `else if` chain starts with, and its number of branches when it ends with an `else` (else 0). */
function chainOf(s: IfStatement): { root: IfStatement; size: number } {
  let root = s;
  for (let p = root.getParent(); Node.isIfStatement(p) && p.getElseStatement() === root; p = root.getParent()) root = p;
  let size = 1;
  let last = root;
  for (let e = last.getElseStatement(); Node.isIfStatement(e); e = last.getElseStatement()) {
    last = e;
    size++;
  }
  return { root, size: last.getElseStatement() ? size + 1 : 0 };
}

/** A block between `n` and its parent `p` that may not run: a branch, a loop body, a case, a handler, a short circuit. */
function mayNotRun(n: Node, p: Node): boolean {
  if (Node.isForStatement(p) || Node.isForInStatement(p) || Node.isForOfStatement(p) || Node.isWhileStatement(p)) return n === p.getStatement();
  if (Node.isCaseClause(p) || Node.isDefaultClause(p) || Node.isCatchClause(p)) return true;
  if (Node.isConditionalExpression(p)) return n !== p.getCondition();
  if (Node.isBinaryExpression(p)) return n === p.getRight() && [SyntaxKind.AmpersandAmpersandToken, SyntaxKind.BarBarToken, SyntaxKind.QuestionQuestionToken].includes(p.getOperatorToken().getKind());
  return false;
}

export function reachOf(edit: Node, use: Node): Reach {
  const branches: Reach[] = [];
  for (let n = edit, p = n.getParent(); p && !contains(p, use); n = p, p = p.getParent()) {
    if (Node.isIfStatement(p) && n !== p.getExpression()) {
      // `else if`: the inner `if` is one more branch of the same chain
      if (n === p.getElseStatement() && Node.isIfStatement(n)) continue;
      const { root, size } = chainOf(p);
      branches.push(size > 0 ? { kind: "group", group: root.getStart(), branch: n.getStart(), size } : { kind: "maybe" });
    } else if (mayNotRun(n, p)) branches.push({ kind: "maybe" });
  }
  if (branches.length === 0) return { kind: "always" };
  return branches.length === 1 ? branches[0]! : { kind: "maybe" };
}
