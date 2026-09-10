import { Node, SyntaxKind, type Expression } from "ts-morph";
import { unwrap } from "../detect/callee.js";
import { declarationsOf, paramSubstitution, propertyKey } from "../detect/options.js";
import type { BodyEncoding, DynamicOrigin, DynamicPart, EvalCtx, Shape } from "../types.js";
import { evaluate, staticText } from "./evaluate.js";
import { collectAppendedKeys } from "./appended.js";
import { dedupe, mergeLiterals, typeToShape } from "./type-shape.js";

const MAX_DEPTH = 6;

export interface BodyResult {
  shape?: Shape;
  encoding: BodyEncoding;
  dynamic: DynamicPart[];
  fromType?: string;
  fromLiteral: boolean;
}

function isUndefinedExpr(e: Expression): boolean {
  const u = unwrap(e);
  return Node.isIdentifier(u) && u.getText() === "undefined";
}

function literalToShape(u: Expression, ctx: EvalCtx, depth: number): Shape | undefined {
  if (Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u)) return { type: "string", enum: [u.getLiteralValue()] };
  if (Node.isTemplateExpression(u)) {
    const text = staticText(evaluate(u, ctx, depth));
    return text !== undefined ? { type: "string", enum: [text] } : { type: "string" };
  }
  if (Node.isNumericLiteral(u)) {
    const n = Number(u.getText());
    return { type: Number.isInteger(n) ? "integer" : "number", enum: [n] };
  }
  if (Node.isPrefixUnaryExpression(u) && Node.isNumericLiteral(u.getOperand())) return { type: "number" };
  if (u.getKind() === SyntaxKind.TrueKeyword) return { type: "boolean", enum: [true] };
  if (u.getKind() === SyntaxKind.FalseKeyword) return { type: "boolean", enum: [false] };
  if (u.getKind() === SyntaxKind.NullKeyword) return { type: "null" };
  if (Node.isArrayLiteralExpression(u)) {
    return { type: "array", items: unionOf(u.getElements().map((el) => shapeOf(el, ctx, depth + 1).shape)) };
  }
  return undefined;
}

interface ShapeResult {
  shape: Shape;
  fromLiteral: boolean;
  origin?: DynamicOrigin;
}

function unionOf(shapes: Shape[]): Shape {
  const items = dedupe(shapes);
  if (items.length === 0) return { type: "unknown" };
  if (items.length === 1) return items[0]!;
  return mergeLiterals(items) ?? { type: "union", anyOf: items };
}

function mergeSpread(target: { properties: Record<string, Shape>; required: string[]; dynamicKeys: boolean }, spread: Shape): void {
  if (spread.type === "object") {
    Object.assign(target.properties, spread.properties);
    for (const r of spread.required) if (!target.required.includes(r)) target.required.push(r);
    if (spread.dynamicKeys) target.dynamicKeys = true;
    return;
  }
  if (spread.type === "union") {
    const objs = spread.anyOf.filter((s) => s.type === "object");
    for (const o of objs) mergeSpread({ ...target, required: [] }, o);
    const commonRequired = objs.length > 0 ? objs.map((o) => (o.type === "object" ? o.required : [])).reduce((a, b) => a.filter((x) => b.includes(x))) : [];
    for (const r of commonRequired) if (!target.required.includes(r)) target.required.push(r);
    if (objs.length !== spread.anyOf.length) target.dynamicKeys = true;
    return;
  }
  target.dynamicKeys = true;
}

function objectLiteralShape(u: Expression, ctx: EvalCtx, depth: number, dynamic: DynamicPart[]): Shape {
  if (!Node.isObjectLiteralExpression(u)) return { type: "unknown" };
  const acc = { properties: {} as Record<string, Shape>, required: [] as string[], dynamicKeys: false };
  for (const member of u.getProperties()) {
    if (Node.isSpreadAssignment(member)) {
      const r = shapeOf(member.getExpression(), ctx, depth + 1, dynamic);
      mergeSpread(acc, r.shape);
      if (r.shape.type === "dynamic" || r.shape.type === "unknown") dynamic.push({ where: "body", name: `...${member.getExpression().getText().slice(0, 40)}`, origin: originOf(r.shape) });
      continue;
    }
    const key = propertyKey(member);
    if (key === undefined) {
      acc.dynamicKeys = true;
      continue;
    }
    const valueExpr = Node.isPropertyAssignment(member) ? member.getInitializer() : Node.isShorthandPropertyAssignment(member) ? member.getNameNode() : undefined;
    if (!valueExpr) continue;
    if (isUndefinedExpr(valueExpr)) continue;
    const r = shapeOf(valueExpr, ctx, depth + 1, dynamic);
    acc.properties[key] = r.shape;
    if (!(r.shape.type === "union" && r.shape.anyOf.some((s) => s.type === "null") && !r.fromLiteral)) acc.required.push(key);
    if (!r.fromLiteral) dynamic.push({ where: "body", name: key, origin: r.origin ?? originOf(r.shape) });
  }
  return { type: "object", properties: acc.properties, required: acc.required, ...(acc.dynamicKeys ? { dynamicKeys: true } : {}) };
}

function originOf(s: Shape): string {
  return s.type === "dynamic" ? s.origin : s.type === "unknown" ? "unknown" : "type";
}

function fromChecker(u: Expression, origin: "param" | "call" | "unknown", hint?: string): ShapeResult {
  const t = typeToShape(u.getType(), u);
  if (t.shape.type === "unknown") return { shape: { type: "dynamic", origin, hint }, fromLiteral: false, origin };
  return { shape: t.shape, fromLiteral: false, origin };
}

function identifierShape(u: Expression, ctx: EvalCtx, depth: number, dynamic: DynamicPart[]): ShapeResult {
  for (const decl of declarationsOf(u)) {
    const sub = paramSubstitution(decl, ctx);
    if (sub.isParam) return sub.expr ? shapeOf(sub.expr, ctx, depth + 1, dynamic) : fromChecker(u, "param", u.getText());
    if (Node.isVariableDeclaration(decl) && decl.getInitializer()) return shapeOf(decl.getInitializer()!, ctx, depth + 1, dynamic);
  }
  return fromChecker(u, "unknown", u.getText());
}

/** Shape of an arbitrary expression: literals first, then constants, then the type checker. */
export function shapeOf(expr: Expression, ctx: EvalCtx = {}, depth = 0, dynamic: DynamicPart[] = []): ShapeResult {
  const u = unwrap(expr);
  if (depth > MAX_DEPTH) return { shape: { type: "unknown" }, fromLiteral: false };
  const lit = literalToShape(u, ctx, depth);
  if (lit) return { shape: lit, fromLiteral: true };
  if (Node.isObjectLiteralExpression(u)) return { shape: objectLiteralShape(u, ctx, depth, dynamic), fromLiteral: true };
  if (Node.isIdentifier(u)) return identifierShape(u, ctx, depth, dynamic);
  if (Node.isConditionalExpression(u)) {
    const a = shapeOf(u.getWhenTrue(), ctx, depth + 1, dynamic);
    const b = shapeOf(u.getWhenFalse(), ctx, depth + 1, dynamic);
    return { shape: unionOf([a.shape, b.shape]), fromLiteral: false, origin: a.fromLiteral && b.fromLiteral ? "unknown" : (a.origin ?? b.origin) };
  }
  if (Node.isCallExpression(u)) return fromChecker(u, "call", u.getExpression().getText().slice(0, 40));
  const first = evaluate(u, ctx, depth)[0];
  if (first?.kind === "env") return { shape: { type: "string" }, fromLiteral: false, origin: "env" };
  return fromChecker(u, "unknown", u.getText().slice(0, 40));
}

function appendedKeys(varExpr: Expression): string[] {
  return collectAppendedKeys(varExpr, ["append", "set"]);
}

function keysToShape(keys: string[]): Shape {
  const properties: Record<string, Shape> = {};
  for (const k of keys) properties[k] = { type: "string" };
  return { type: "object", properties, required: keys, ...(keys.length === 0 ? { dynamicKeys: true } : {}) };
}

function unwrapEncoding(expr: Expression, ctx: EvalCtx, depth: number): { inner?: Expression; encoding: BodyEncoding; keys?: string[] } {
  const u = unwrap(expr);
  if (Node.isCallExpression(u) && u.getExpression().getText().replace(/\s/g, "") === "JSON.stringify") {
    return { inner: u.getArguments()[0] as Expression | undefined, encoding: "json" };
  }
  if (Node.isNewExpression(u)) {
    const name = u.getExpression().getText();
    const arg = u.getArguments()[0] as Expression | undefined;
    if (name === "URLSearchParams") return { inner: arg, encoding: "form", keys: appendedKeys(expr) };
    if (name === "FormData") return { inner: undefined, encoding: "multipart", keys: appendedKeys(expr) };
  }
  if (Node.isIdentifier(u) && depth < 3) {
    const decl = u.getSymbol()?.getDeclarations()[0];
    const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
    if (init) {
      const inner = unwrapEncoding(init, ctx, depth + 1);
      if (inner.encoding !== "json" || inner.inner !== init) return { ...inner, keys: [...(inner.keys ?? []), ...appendedKeys(u)] };
    }
  }
  return { inner: expr, encoding: "json" };
}

function parseJsonString(u: Expression, ctx: EvalCtx): Shape | undefined {
  const text = staticText(evaluate(u, ctx));
  if (text === undefined) return undefined;
  try {
    return jsonToShape(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function jsonToShape(v: unknown): Shape {
  if (v === null) return { type: "null" };
  if (typeof v === "string") return { type: "string", enum: [v] };
  if (typeof v === "number") return { type: Number.isInteger(v) ? "integer" : "number", enum: [v] };
  if (typeof v === "boolean") return { type: "boolean", enum: [v] };
  if (Array.isArray(v)) return { type: "array", items: unionOf(v.map(jsonToShape)) };
  const o = v as Record<string, unknown>;
  const properties = Object.fromEntries(Object.entries(o).map(([k, x]) => [k, jsonToShape(x)]));
  return { type: "object", properties, required: Object.keys(o) };
}

/** Resolves a request body expression into shape + encoding + dynamic parts. */
export function resolveBody(expr: Expression | undefined, ctx: EvalCtx = {}, defaultEncoding: BodyEncoding = "json"): BodyResult {
  if (!expr) return { encoding: "none", dynamic: [], fromLiteral: false };
  const { inner, encoding, keys } = unwrapEncoding(expr, ctx, 0);
  const enc = encoding === "json" ? defaultEncoding : encoding;
  if (!inner) return { shape: keysToShape(keys ?? []), encoding: enc, dynamic: [], fromLiteral: true };
  const u = unwrap(inner);
  if (Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u) || Node.isTemplateExpression(u)) {
    const parsed = parseJsonString(u, ctx);
    if (parsed) return { shape: parsed, encoding: "json", dynamic: [], fromLiteral: true };
    return { shape: { type: "string" }, encoding: "raw", dynamic: [], fromLiteral: true };
  }
  const dynamic: DynamicPart[] = [];
  const r = shapeOf(inner, ctx, 0, dynamic);
  let shape = r.shape;
  if (keys && keys.length > 0 && shape.type === "object") {
    const extra = keysToShape(keys);
    shape = { ...shape, properties: { ...shape.properties, ...(extra.type === "object" ? extra.properties : {}) } };
  }
  if (shape.type === "dynamic" || shape.type === "unknown") dynamic.push({ where: "body", name: "body", origin: originOf(shape) });
  const fromType = shape.type === "object" ? shape.fromType : undefined;
  return { shape, encoding: shape.type === "dynamic" && shape.hint === "Buffer" ? "raw" : enc, dynamic, fromType, fromLiteral: r.fromLiteral };
}
