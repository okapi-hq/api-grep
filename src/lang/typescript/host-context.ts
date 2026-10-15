import { ts } from "ts-morph";
import { calleeRole, keyRole, type LiteralRole } from "../../hosts/context.js";

/** How far up a literal's call is looked for: `console.log(chalk.bold(`...`))` is a few levels, a statement stops it anyway. */
const MAX_DEPTH = 12;

const isBoundary = (n: ts.Node): boolean => ts.isFunctionLike(n) || ts.isBlock(n) || ts.isSourceFile(n) || ts.isClassLike(n) || ts.isStatement(n);

/**
 * `text` when the literal is (part of) an argument of a logging, printing or navigating call or an error's
 * constructor, through formatting calls (`console.log(chalk.red("..."))`); the first other call
 * (`console.log(await fetch("..."))`, `new URL("...")`) ends the search.
 */
function callRole(n: ts.Node, sf: ts.SourceFile): LiteralRole | undefined {
  let cur = n;
  for (let p = n.parent, depth = 0; p && depth < MAX_DEPTH && !isBoundary(p); cur = p, p = p.parent, depth++) {
    let callee: ts.Node | undefined;
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) callee = p.expression;
    else if (ts.isTaggedTemplateExpression(p)) callee = p.tag;
    if (!callee) continue;
    const role = calleeRole(callee.getText(sf));
    if (role === "text" && cur !== callee) return "text";
    if (role !== "format") return undefined;
  }
  return undefined;
}

/** The expression a literal is the value of, through parentheses, `as`, defaults (`a || "..."`), branches and arrays. */
function valueOf(n: ts.Node): ts.Node {
  let cur = n;
  for (let p = cur.parent; p; cur = p, p = p.parent) {
    const through =
      ts.isParenthesizedExpression(p) ||
      ts.isAsExpression(p) ||
      ts.isJsxExpression(p) ||
      ts.isArrayLiteralExpression(p) ||
      (ts.isConditionalExpression(p) && p.condition !== cur) ||
      (ts.isBinaryExpression(p) && p.right === cur && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind));
    if (!through) return cur;
  }
  return cur;
}

/** A property, attribute or variable name as written (`url`, `"homepage"`, `data-href`). */
const nameText = (n: ts.Node, sf: ts.SourceFile): string => (n as { text?: string }).text ?? n.getText(sf);

/**
 * The role the key or name a literal is the value of gives it: an object's property (its siblings decide a `url`), a
 * JSX attribute (`href`), an assigned property (`location.href = ...`, `options.authorizationURL = ...`), a variable.
 */
function keyContext(n: ts.Node, sf: ts.SourceFile): LiteralRole | undefined {
  const v = valueOf(n);
  const p = v.parent;
  if (!p) return undefined;
  if (ts.isPropertyAssignment(p) && p.initializer === v && ts.isObjectLiteralExpression(p.parent)) {
    const siblings = p.parent.properties.filter((q) => q !== p && q.name).map((q) => nameText(q.name!, sf));
    return keyRole(nameText(p.name, sf), siblings);
  }
  if (ts.isJsxAttribute(p)) return keyRole(nameText(p.name, sf));
  if (ts.isBinaryExpression(p) && p.right === v && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(p.left)) return keyRole(p.left.name.text);
  if (ts.isVariableDeclaration(p) && p.initializer === v && ts.isIdentifier(p.name)) return keyRole(p.name.text);
  return undefined;
}

/** What a string literal of a TypeScript or JavaScript file is, for `coverage.hosts` (`src/hosts/context.ts`). */
export function literalRole(n: ts.Node, sf: ts.SourceFile): LiteralRole | undefined {
  return callRole(n, sf) ?? keyContext(n, sf);
}

/** Vitest's in-source tests, `if (import.meta.vitest) { ... }`: test code, whose literals are not read. */
export const isInSourceTest = (n: ts.Node, sf: ts.SourceFile): boolean => ts.isIfStatement(n) && n.expression.getText(sf) === "import.meta.vitest";
