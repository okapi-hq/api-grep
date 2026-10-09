import { Node, type Expression, type ObjectLiteralExpression, type VariableDeclaration } from "ts-morph";
import { isSafeKey } from "../record-keys.js";
import type { EvalCtx } from "../types.js";
import { unwrap } from "./expr.js";

/** Object hops per property read: a parameter to its argument, a spread, a const; two per wrapper an object is passed down. */
const MAX_DEPTH = 8;

function keyText(nameNode: Node): string | undefined {
  if (Node.isIdentifier(nameNode) || Node.isPrivateIdentifier(nameNode)) return nameNode.getText();
  if (Node.isStringLiteral(nameNode) || Node.isNoSubstitutionTemplateLiteral(nameNode)) return nameNode.getLiteralValue();
  if (Node.isNumericLiteral(nameNode)) return nameNode.getText();
  if (Node.isComputedPropertyName(nameNode)) {
    const inner = unwrap(nameNode.getExpression());
    if (Node.isStringLiteral(inner) || Node.isNoSubstitutionTemplateLiteral(inner)) return inner.getLiteralValue();
  }
  return undefined;
}

/** Property key text for object literal members (identifier, string, or string-literal computed key); an unsafe key reads as computed. */
export function propertyKey(member: Node): string | undefined {
  if (!Node.isPropertyAssignment(member) && !Node.isShorthandPropertyAssignment(member) && !Node.isMethodDeclaration(member)) return undefined;
  const key = keyText(member.getNameNode());
  return key !== undefined && isSafeKey(key) ? key : undefined;
}

/** Value of an object literal member: its initializer, or the identifier of a shorthand `{ x }`. */
export function propertyValue(member: Node): Expression | undefined {
  if (Node.isPropertyAssignment(member)) return member.getInitializer();
  if (Node.isShorthandPropertyAssignment(member)) return member.getNameNode();
  return undefined;
}

/** Declarations behind an identifier; shorthand `{ x }` resolves to the variable, not the property. */
export function declarationsOf(ident: Expression): Node[] {
  if (!Node.isIdentifier(ident)) return [];
  const parent = ident.getParent();
  if (Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === ident) {
    return parent.getValueSymbol()?.getDeclarations() ?? [];
  }
  return ident.getSymbol()?.getDeclarations() ?? [];
}

export interface Substitution {
  /** True when the declaration is a parameter (or a destructured piece of one). */
  isParam: boolean;
  expr?: Expression;
}

/** Wrapper expansion: maps a parameter (or a binding element of one) to the caller's argument. */
export function paramSubstitution(decl: Node, ctx: EvalCtx): Substitution {
  if (Node.isParameterDeclaration(decl)) return { isParam: true, expr: ctx.subst?.get(decl) };
  if (Node.isBindingElement(decl)) {
    const param = decl.getFirstAncestor((a) => Node.isParameterDeclaration(a));
    if (!param) return { isParam: false };
    const sub = ctx.subst?.get(param);
    if (!sub || decl.getParent().getParent() !== param) return { isParam: true };
    const name = decl.getPropertyNameNode()?.getText() ?? decl.getName();
    return { isParam: true, expr: getProp(sub, name, ctx) ?? decl.getInitializer() };
  }
  return { isParam: false };
}

/**
 * `const { body } = options` → the `body` property of what `options` resolves to (param substitution included).
 * A rest element (`...rest`) stands for the source object itself (sibling keys are not subtracted).
 */
export function bindingElementValue(decl: Node, ctx: EvalCtx = {}, depth = 0): Expression | undefined {
  if (!Node.isBindingElement(decl) || depth > MAX_DEPTH) return undefined;
  const pattern = decl.getParent();
  const owner = pattern.getParent();
  if (!Node.isObjectBindingPattern(pattern) || !Node.isVariableDeclaration(owner)) return undefined;
  const init = owner.getInitializer();
  if (!init) return undefined;
  if (decl.getDotDotDotToken()) return init;
  const name = decl.getPropertyNameNode()?.getText() ?? decl.getName();
  return getProp(init, name, ctx, depth + 1) ?? decl.getInitializer();
}

/** `import { config } from "./config"`: the variable a project file exports under that name. */
function importedVariable(ident: Expression): VariableDeclaration | undefined {
  const sym = ident.getSymbol();
  if (!sym?.isAlias()) return undefined;
  const decls = sym.getAliasedSymbol()?.getDeclarations() ?? [];
  return decls.find((d): d is VariableDeclaration => Node.isVariableDeclaration(d) && !d.getSourceFile().isFromExternalLibrary());
}

/**
 * Resolves an expression to an object literal through const identifiers (imported ones too), nested properties
 * (`CONFIG.API`) and parameter substitution.
 */
export function toObjectLiteral(expr: Expression | undefined, ctx: EvalCtx = {}, depth = 0): ObjectLiteralExpression | undefined {
  if (!expr || depth > MAX_DEPTH) return undefined;
  const u = unwrap(expr);
  if (Node.isObjectLiteralExpression(u)) return u;
  if (Node.isPropertyAccessExpression(u)) return toObjectLiteral(getProp(u.getExpression(), u.getName(), ctx, depth + 1), ctx, depth + 1);
  if (Node.isIdentifier(u)) {
    for (const decl of declarationsOf(u)) {
      const sub = paramSubstitution(decl, ctx);
      if (sub.isParam) return sub.expr ? toObjectLiteral(sub.expr, ctx, depth + 1) : undefined;
      if (Node.isVariableDeclaration(decl)) return toObjectLiteral(decl.getInitializer(), ctx, depth + 1);
      if (Node.isBindingElement(decl)) return toObjectLiteral(bindingElementValue(decl, ctx, depth + 1), ctx, depth + 1);
    }
    return toObjectLiteral(importedVariable(u)?.getInitializer(), ctx, depth + 1);
  }
  return undefined;
}

/** Looks a property up in an (object-literal-resolvable) expression, following spreads; the last definition wins, as at runtime. */
export function getProp(obj: Expression | undefined, name: string, ctx: EvalCtx = {}, depth = 0): Expression | undefined {
  const lit = toObjectLiteral(obj, ctx, depth);
  if (!lit || depth > MAX_DEPTH) return undefined;
  for (const member of [...lit.getProperties()].reverse()) {
    if (Node.isSpreadAssignment(member)) {
      const inner = getProp(member.getExpression(), name, ctx, depth + 1);
      if (inner) return inner;
      continue;
    }
    const value = propertyKey(member) === name ? propertyValue(member) : undefined;
    if (value) return value;
  }
  return undefined;
}
