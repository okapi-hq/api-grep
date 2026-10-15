import { Node, SyntaxKind, VariableDeclarationKind, type CallExpression, type Expression, type NewExpression, type VariableDeclaration } from "ts-morph";
import { unwrap } from "./expr.js";
import { declarationsOf } from "./object.js";

type Construction = CallExpression | NewExpression;

const ASSIGNS = new Set([SyntaxKind.EqualsToken, SyntaxKind.QuestionQuestionEqualsToken, SyntaxKind.BarBarEqualsToken]);
const MEMO = new WeakMap<VariableDeclaration, Construction | null>();

/** No value of its own: `let client;`, `let client: OpenAI | null = null`. */
function unset(init: Expression | undefined): boolean {
  if (!init) return true;
  const u = unwrap(init);
  return Node.isNullLiteral(u) || (Node.isIdentifier(u) && u.getText() === "undefined");
}

/**
 * A lazy singleton (`let client; function get() { client ??= new OpenAI(); return client }`): the construction a `let`
 * or `var` declared without a value is given in its file, the first one.
 */
export function assignedConstruction(decl: VariableDeclaration): Construction | undefined {
  const memo = MEMO.get(decl);
  if (memo !== undefined) return memo ?? undefined;
  let found: Construction | null = null;
  const list = decl.getVariableStatement()?.getDeclarationKind();
  if (list !== VariableDeclarationKind.Const && unset(decl.getInitializer()) && Node.isIdentifier(decl.getNameNode())) {
    const name = decl.getName();
    for (const bin of decl.getSourceFile().getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const left = bin.getLeft();
      if (!ASSIGNS.has(bin.getOperatorToken().getKind()) || !Node.isIdentifier(left) || left.getText() !== name) continue;
      const right = unwrap(bin.getRight());
      if ((Node.isCallExpression(right) || Node.isNewExpression(right)) && declarationsOf(left)[0] === decl) {
        found = right;
        break;
      }
    }
  }
  MEMO.set(decl, found);
  return found ?? undefined;
}
