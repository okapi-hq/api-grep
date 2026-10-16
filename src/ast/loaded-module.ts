import { Node, SyntaxKind, VariableDeclarationKind, type Expression, type VariableDeclaration } from "ts-morph";
import { guardedValue } from "./expr.js";
import { identifierOrigin, packageFromSpecifier } from "./origin.js";

export interface LoadedModule {
  package: string;
  importedName: string;
}

const MAX_DEPTH = 4;

/** `require("pkg")` / `import("pkg")` (awaited or not): the package and how much of it the value is. */
function loaderCall(e: Expression): LoadedModule | undefined {
  if (!Node.isCallExpression(e)) return undefined;
  const fn = e.getExpression();
  const dynamic = fn.getKind() === SyntaxKind.ImportKeyword;
  const arg = e.getArguments()[0];
  if ((!dynamic && fn.getText() !== "require") || !arg || !Node.isStringLiteral(arg)) return undefined;
  const pkg = packageFromSpecifier(arg.getLiteralValue());
  return pkg ? { package: pkg, importedName: dynamic ? "*" : "default" } : undefined;
}

/** `import("pkg").then((mod) => ...)`: the callback's first parameter is the module. */
function thenModule(param: Node): LoadedModule | undefined {
  const fn = param.getParent();
  const call = fn?.getParent();
  if (!Node.isParameterDeclaration(param) || !fn || (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) || fn.getParameters()[0] !== param) return undefined;
  if (!Node.isCallExpression(call) || call.getArguments()[0] !== fn) return undefined;
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== "then") return undefined;
  const loaded = loaderCall(guardedValue(callee.getExpression()));
  return loaded ? { ...loaded, importedName: "*" } : undefined;
}

/**
 * The SDK module a value is, loaded on demand: `require("pkg")`, `require("pkg").default`, `await import("pkg")`, the
 * module a `.then` callback is handed, a constant bound to one, `mod.default || mod.Client` (both the package's).
 */
export function loadedModule(expr: Expression, depth = 0): LoadedModule | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const u = guardedValue(expr);
  const direct = loaderCall(u);
  if (direct) return direct;
  if (Node.isBinaryExpression(u) && [SyntaxKind.BarBarToken, SyntaxKind.QuestionQuestionToken].includes(u.getOperatorToken().getKind())) {
    const [a, b] = [loadedModule(u.getLeft(), depth + 1), loadedModule(u.getRight(), depth + 1)];
    return a && b && a.package === b.package ? a : undefined;
  }
  if (Node.isPropertyAccessExpression(u)) {
    const owner = loadedModule(u.getExpression(), depth + 1);
    // `require("pkg").X` is the export X; `(await import("pkg")).X` too
    return owner && (owner.importedName === "default" || owner.importedName === "*") ? { package: owner.package, importedName: u.getName() } : undefined;
  }
  if (!Node.isIdentifier(u)) return undefined;
  const decl = u.getSymbol()?.getDeclarations()[0];
  if (decl && Node.isParameterDeclaration(decl)) return thenModule(decl);
  if (decl && Node.isVariableDeclaration(decl)) {
    const init = decl.getInitializer();
    if (init) return loadedModule(init, depth + 1);
  }
  const o = identifierOrigin(u);
  return o.kind === "package" ? { package: o.package, importedName: o.importedName } : undefined;
}

/**
 * `let Purchases = null; ... Purchases = require("react-native-purchases").default`: the SDK module a `let` declared
 * without a value is given later in its file, when every module assigned to it is that package's.
 */
export function assignedModule(decl: VariableDeclaration): LoadedModule | undefined {
  if (decl.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const || !Node.isIdentifier(decl.getNameNode())) return undefined;
  const init = decl.getInitializer();
  if (init && !Node.isNullLiteral(guardedValue(init))) return undefined;
  const name = decl.getName();
  let found: LoadedModule | undefined;
  for (const bin of decl.getSourceFile().getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const left = bin.getLeft();
    if (bin.getOperatorToken().getKind() !== SyntaxKind.EqualsToken || !Node.isIdentifier(left) || left.getText() !== name) continue;
    if (left.getSymbol()?.getDeclarations()[0] !== decl) continue;
    const m = loadedModule(bin.getRight());
    if (m && found && m.package !== found.package) return undefined;
    found = found ?? m;
  }
  return found;
}
