import { Node, SyntaxKind, type Expression } from "ts-morph";
import { constructedName, isUndefinedLiteral, unwrap } from "../ast/expr.js";
import { bindingElementValue, declarationsOf, paramSubstitution, propertyKey, propertyValue } from "../ast/object.js";
import type { BodyEncoding, DynamicOrigin, DynamicPart, EvalCtx, Shape } from "../types.js";
import { evaluate, staticText } from "./evaluate.js";
import { collectAppendedKeys } from "./appended.js";
import { formStringShape, jsonToShape, unionOf } from "./shape-utils.js";
import { isNullable, typeToShape } from "./type-shape.js";

const MAX_DEPTH = 6;

export interface BodyResult {
  shape?: Shape;
  encoding: BodyEncoding;
  dynamic: DynamicPart[];
  fromType?: string;
  fromLiteral: boolean;
}

function literalToShape(u: Expression, ctx: EvalCtx, depth: number): Shape | undefined {
  if (Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u)) return { type: "string", enum: [u.getLiteralValue()] };
  if (Node.isTemplateExpression(u)) {
    const text = staticText(evaluate(u, ctx, depth));
    return text !== undefined ? { type: "string", enum: [text] } : { type: "string" };
  }
  if (Node.isNumericLiteral(u)) {
    // getLiteralValue() reads `30_000` and `0x10`; Number(getText()) gives NaN for separators, which breaks the schema.
    const n = u.getLiteralValue();
    if (!Number.isFinite(n)) return { type: "number" };
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
    const valueExpr = propertyValue(member);
    if (!valueExpr || isUndefinedLiteral(valueExpr)) continue;
    const r = shapeOf(valueExpr, ctx, depth + 1, dynamic);
    acc.properties[key] = r.shape;
    if (r.fromLiteral || !isNullable(r.shape)) acc.required.push(key);
    if (!r.fromLiteral) dynamic.push({ where: "body", name: key, origin: r.origin ?? originOf(r.shape) });
  }
  return { type: "object", properties: acc.properties, required: acc.required, ...(acc.dynamicKeys ? { dynamicKeys: true } : {}) };
}

function originOf(s: Shape): string {
  return s.type === "dynamic" ? s.origin : s.type === "unknown" ? "unknown" : "type";
}

const GENERIC_HINT = /^(input|data|value|body|params|opts|options|args|payload|req|res|result|item|obj|e|x|v)$/;

/** Scalars keep the source identifier as a hint (`{ username: email }` is an email) unless the name is generic. */
function withHint(shape: Shape, hint: string | undefined): Shape {
  if (shape.type !== "string" && shape.type !== "number" && shape.type !== "integer" && shape.type !== "boolean") return shape;
  if (!hint || !/^[A-Za-z_$][\w$]*$/.test(hint) || GENERIC_HINT.test(hint)) return shape;
  return { ...shape, hint };
}

function fromChecker(u: Expression, origin: "param" | "call" | "unknown", hint?: string): ShapeResult {
  const t = typeToShape(u.getType(), u);
  if (t.shape.type === "unknown") return { shape: { type: "dynamic", origin, hint }, fromLiteral: false, origin };
  return { shape: withHint(t.shape, hint), fromLiteral: false, origin };
}

function identifierShape(u: Expression, ctx: EvalCtx, depth: number, dynamic: DynamicPart[]): ShapeResult {
  for (const decl of declarationsOf(u)) {
    const sub = paramSubstitution(decl, ctx);
    if (sub.isParam) return sub.expr ? shapeOf(sub.expr, ctx, depth + 1, dynamic) : fromChecker(u, "param", u.getText());
    if (Node.isVariableDeclaration(decl) && decl.getInitializer()) return shapeOf(decl.getInitializer()!, ctx, depth + 1, dynamic);
    const bound = bindingElementValue(decl, ctx);
    if (bound) return shapeOf(bound, ctx, depth + 1, dynamic);
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

const FORM_STRINGIFY_RE = /^(qs|querystring|queryString)\.stringify$|^stringify$/;

/** `body ? JSON.stringify(body) : undefined` → the defined branch; `x.toString()` → x. */
function stripBodyWrappers(expr: Expression): Expression {
  const u = unwrap(expr);
  if (Node.isConditionalExpression(u)) {
    const [a, b] = [unwrap(u.getWhenTrue()), unwrap(u.getWhenFalse())];
    if (isUndefinedLiteral(b) || b.getKind() === SyntaxKind.NullKeyword) return stripBodyWrappers(a);
    if (isUndefinedLiteral(a) || a.getKind() === SyntaxKind.NullKeyword) return stripBodyWrappers(b);
  }
  if (Node.isCallExpression(u) && u.getArguments().length === 0) {
    const callee = u.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === "toString") return stripBodyWrappers(callee.getExpression());
  }
  return u;
}

function unwrapEncoding(expr: Expression, ctx: EvalCtx, depth: number): { inner?: Expression; encoding: BodyEncoding; keys?: string[] } {
  const u = stripBodyWrappers(expr);
  if (Node.isCallExpression(u)) {
    const callee = u.getExpression().getText().replace(/\s/g, "");
    if (callee === "JSON.stringify") return { inner: u.getArguments()[0] as Expression | undefined, encoding: "json" };
    if (FORM_STRINGIFY_RE.test(callee)) return { inner: u.getArguments()[0] as Expression | undefined, encoding: "form" };
  }
  if (Node.isNewExpression(u)) {
    const name = constructedName(u);
    const arg = u.getArguments()[0] as Expression | undefined;
    if (name === "URLSearchParams") return { inner: arg, encoding: "form", keys: appendedKeys(expr) };
    if (name === "FormData") return { inner: undefined, encoding: "multipart", keys: appendedKeys(expr) };
  }
  if (Node.isIdentifier(u) && depth < 3) {
    const decl = declarationsOf(u)[0];
    const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : decl ? bindingElementValue(decl, ctx) : undefined;
    if (init) {
      const inner = unwrapEncoding(init, ctx, depth + 1);
      if (inner.encoding !== "json" || inner.inner !== unwrap(init)) return { ...inner, keys: [...(inner.keys ?? []), ...appendedKeys(u)] };
    }
  }
  return { inner: u, encoding: "json" };
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
    const form = formStringShape(evaluate(u, ctx));
    if (form) return { shape: form, encoding: "form", dynamic: [], fromLiteral: true };
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
