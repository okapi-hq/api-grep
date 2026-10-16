import { Node, VariableDeclarationKind, type ElementAccessExpression, type Expression } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import { getProp, paramSubstitution, tableEntries } from "../ast/object.js";
import type { EvalCtx, Part } from "../types.js";
import { choose } from "./choice.js";
import { evaluate } from "./evaluate.js";
import { hasStaticHost, markConst } from "./parts.js";

/** Reading an entry of a table the code writes, with a key it fixes or one known at run time only (`choice.ts`). */

/**
 * `PRESETS["openai"]` (or a constant key) reads that entry; `HOSTS[region]` with an unknown key the entry a host
 * table's pick reads (`choice.ts`), else the first entry with a literal host.
 */
export function evalElementAccess(u: ElementAccessExpression, ctx: EvalCtx, depth: number): Part[] | undefined {
  const arg = u.getArgumentExpression();
  const key = arg ? knownValue(arg, ctx) : undefined;
  if (key !== undefined) {
    const inner = getProp(u.getExpression(), key, ctx);
    return inner ? markConst(evaluate(inner, ctx, depth + 1)) : undefined;
  }
  const entries = tableEntries(u.getExpression(), ctx);
  const picked = choose(ctx.choice, u.compilerNode, entries);
  if (picked) return markConst(evaluate(picked, ctx, depth + 1));
  for (const value of entries) {
    const parts = evaluate(value, ctx, depth + 1);
    if (hasStaticHost(parts)) return markConst(parts);
  }
  return undefined;
}

const PASSTHROUGH = new Set(["toLowerCase", "toUpperCase", "trim", "toString"]);

/**
 * The text of a value the code fixes, as a table key or a helper's argument: a literal, through `const`s, enum members,
 * constant objects' properties and a wrapper's arguments. Undefined for anything else, a best guess included (a
 * parameter's default, a conditional's first branch, a helper's first return): a caller may pass another value.
 */
export function knownValue(e: Expression, ctx: EvalCtx, depth = 0): string | undefined {
  const u = unwrap(e);
  if (depth > 6) return undefined;
  if (Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u)) return u.getLiteralValue();
  if (Node.isNumericLiteral(u)) return String(u.getLiteralValue());
  if (Node.isCallExpression(u)) {
    const callee = unwrap(u.getExpression());
    return Node.isPropertyAccessExpression(callee) && PASSTHROUGH.has(callee.getName()) ? knownValue(callee.getExpression(), ctx, depth + 1) : undefined;
  }
  if (Node.isPropertyAccessExpression(u)) {
    const prop = getProp(u.getExpression(), u.getName(), ctx);
    if (prop) return knownValue(prop, ctx, depth + 1);
  }
  const decl = Node.isIdentifier(u) || Node.isPropertyAccessExpression(u) ? (u.getSymbol()?.getDeclarations() ?? [])[0] : undefined;
  if (decl && Node.isEnumMember(decl)) {
    const v = decl.getValue();
    return typeof v === "string" || typeof v === "number" ? String(v) : undefined;
  }
  if (!decl || !Node.isIdentifier(u)) return undefined;
  const sub = paramSubstitution(decl, ctx);
  if (sub.isParam) return sub.expr ? knownValue(sub.expr, ctx, depth + 1) : undefined;
  const list = decl.getParent();
  const constant = Node.isVariableDeclaration(decl) && Node.isVariableDeclarationList(list) && list.getDeclarationKind() === VariableDeclarationKind.Const;
  const init = constant ? decl.getInitializer() : undefined;
  return init ? knownValue(init, ctx, depth + 1) : undefined;
}

/** A value from a set the code fixes: `knownValue`, or a condition between such values (`pass ? "clinepass" : "cline"`). */
export function fixedValue(e: Expression, ctx: EvalCtx, depth = 0): boolean {
  const u = unwrap(e);
  if (Node.isConditionalExpression(u) && depth < 4) return fixedValue(u.getWhenTrue(), ctx, depth + 1) && fixedValue(u.getWhenFalse(), ctx, depth + 1);
  return knownValue(u, ctx) !== undefined;
}
