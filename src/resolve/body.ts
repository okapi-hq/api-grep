import { Node, SyntaxKind, type BinaryExpression, type Expression } from "ts-morph";
import { classPropertyInitializer } from "../ast/class.js";
import { isUndefinedLiteral, unwrap } from "../ast/expr.js";
import { bindingElementValue, declarationsOf, importedVariable, paramSubstitution, propertyKey, propertyValue } from "../ast/object.js";
import type { BodyEncoding, DynamicOrigin, DynamicPart, EvalCtx, Shape } from "../types.js";
import { evaluate, staticText } from "./evaluate.js";
import { partsOf, stringShapeOf } from "./string-template.js";
import { xmlBody } from "./xml-shape.js";
import { withEdits } from "./edited-shape.js";
import { astDocumentParts } from "./graphql-ast.js";
import { importedDocument, isDocumentExpression, printedArgument } from "./graphql-source.js";
import { localReturn } from "./local-return.js";
import { givenByEveryCaller, paramShape } from "./param-values.js";
import { keysToShape, parseJsonString, unwrapEncoding } from "./body-encoding.js";
import { loadedValueShape } from "./config-values.js";
import { alternativesOf, formStringShape, unionOf } from "./shape-utils.js";
import { asDefault } from "../model/value-sources.js";
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
  // a GraphQL document (`gql\`...\``) is sent as its text
  if (Node.isTemplateExpression(u) || isDocumentExpression(u)) return stringShapeOf(evaluate(u, ctx, depth));
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
  // `import { CHAT_MODEL } from "./config"`: the constant that file defines
  const imported = importedVariable(u)?.getInitializer();
  if (imported) return shapeOf(imported, ctx, depth + 1, dynamic);
  const document = importedDocument(u);
  if (document) return { shape: stringShapeOf(document), fromLiteral: true };
  for (const decl of declarationsOf(u)) {
    const sub = paramSubstitution(decl, ctx);
    // the callers' own dynamic parts belong to them, not to this request
    if (sub.isParam) return sub.expr ? shapeOf(sub.expr, ctx, depth + 1, dynamic) : paramShape(decl, ctx, (e, c) => shapeOf(e, c, depth + 1), fromChecker(u, "param", u.getText()));
    if (Node.isVariableDeclaration(decl) && decl.getInitializer()) {
      const r = shapeOf(decl.getInitializer()!, ctx, depth + 1, dynamic);
      return { ...r, shape: withEdits(r.shape, decl, u, (e) => shapeOf(e, ctx, depth + 1, dynamic), dynamic) };
    }
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
  if (Node.isObjectLiteralExpression(u)) {
    // a document written as its AST (#56) is sent as its text
    const document = astDocumentParts(u);
    return { shape: document ? stringShapeOf(document) : objectLiteralShape(u, ctx, depth, dynamic), fromLiteral: true };
  }
  if (Node.isIdentifier(u)) return identifierShape(u, ctx, depth, dynamic);
  if (Node.isConditionalExpression(u)) return branchesShape([u.getWhenTrue(), u.getWhenFalse()], ctx, depth, dynamic);
  const loaded = loadedValueShape(u, ctx);
  if (loaded) return { shape: loaded, fromLiteral: false, origin: loaded.type === "string" && loaded.env ? "env" : "unknown" };
  const env = envShape(u, ctx, depth);
  if (env) return env;
  if (isDefaultExpression(u)) {
    // `model ?? "gpt-4o"` where every caller gives `model`: the fallback is never what is sent
    const nullish = u.getOperatorToken().getKind() === SyntaxKind.QuestionQuestionToken;
    if (nullish && givenByEveryCaller(u.getLeft(), ctx)) return shapeOf(u.getLeft(), ctx, depth + 1, dynamic);
    return branchesShape([u.getLeft(), u.getRight()], ctx, depth, dynamic, true);
  }
  if (Node.isCallExpression(u)) return printedShape(u, ctx, depth, dynamic) ?? returnsShape(u, ctx, depth) ?? fromChecker(u, "call", u.getExpression().getText().slice(0, 40));
  return thisFieldShape(u, ctx, depth, dynamic) ?? constantShape(u, ctx, depth) ?? fromChecker(u, "unknown", u.getText().slice(0, 40));
}

/** `this.model`: what the class gives it (`this.model = opts.model ?? "gpt-4o"`; a parameter property's default is a default). */
function thisFieldShape(u: Expression, ctx: EvalCtx, depth: number, dynamic: DynamicPart[]): ShapeResult | undefined {
  if (!Node.isPropertyAccessExpression(u) || !Node.isThisExpression(u.getExpression())) return undefined;
  const init = classPropertyInitializer(u, u.getName());
  if (!init) return undefined;
  // `constructor(private model = "gpt-4o")`: the parameter, read as its callers' values and its default
  const param = init.getParent();
  const name = Node.isParameterDeclaration(param) ? param.getNameNode() : undefined;
  const r = Node.isIdentifier(name) ? identifierShape(name, ctx, depth + 1, dynamic) : shapeOf(init, ctx, depth + 1, dynamic);
  if (r.shape.type === "dynamic" || r.shape.type === "unknown") return undefined;
  return { ...r, fromLiteral: false };
}

/** An env var read (`process.env.MODEL ?? "gpt-4o"`): a string from that variable, its literal default as the value. */
function envShape(u: Expression, ctx: EvalCtx, depth: number): ShapeResult | undefined {
  if (!Node.isPropertyAccessExpression(u) && !Node.isElementAccessExpression(u) && !Node.isCallExpression(u) && !Node.isBinaryExpression(u)) return undefined;
  const parts = evaluate(u, ctx, depth);
  const env = parts.length === 1 && parts[0]!.kind === "env" ? parts[0]! : undefined;
  if (env?.kind !== "env") return undefined;
  return { shape: { type: "string", ...(env.fallback ? { enum: [env.fallback] } : {}), env: env.name }, fromLiteral: false, origin: "env" };
}

/** `a ?? b`, `a || b`: either side can be what runs. */
function isDefaultExpression(u: Expression): u is BinaryExpression {
  if (!Node.isBinaryExpression(u)) return false;
  const op = u.getOperatorToken().getKind();
  return op === SyntaxKind.QuestionQuestionToken || op === SyntaxKind.BarBarToken;
}

/** The shapes of every branch a value can take (a condition, a default); `optionalLeft` drops a missing left side. */
function branchesShape(branches: Expression[], ctx: EvalCtx, depth: number, dynamic: DynamicPart[], optionalLeft = false): ShapeResult {
  const results = branches.map((b) => shapeOf(b, ctx, depth + 1, dynamic));
  const shapes = results.map((r, i) => (optionalLeft && i === 0 && r.shape.type === "union" ? unionOf(r.shape.anyOf.filter((m) => m.type !== "null")) : r.shape));
  // `opts.model ?? "gpt-4o"`: what the right side gives is a fallback
  if (optionalLeft && !results[0]!.fromLiteral) shapes[1] = asDefault(shapes[1]!);
  const literal = results.every((r) => r.fromLiteral);
  return { shape: alternativesOf(shapes), fromLiteral: false, origin: literal ? "unknown" : (results.find((r) => !r.fromLiteral)?.origin ?? "unknown") };
}

const isText = (s: Shape): boolean => s.type === "string" || (s.type === "union" && s.anyOf.every(isText));

/** `print(doc)`: the document's text, when the scan reads it; else the call's type. */
function printedShape(u: Expression, ctx: EvalCtx, depth: number, dynamic: DynamicPart[]): ShapeResult | undefined {
  const printed = printedArgument(u);
  const r = printed ? shapeOf(printed, ctx, depth + 1, dynamic) : undefined;
  return r && isText(r.shape) ? r : undefined;
}

/** What a function of the project returns (`model: getModel()`): the shapes of its returns, its arguments substituted. */
function returnsShape(u: Expression, ctx: EvalCtx, depth: number): ShapeResult | undefined {
  const local = localReturn(u, ctx);
  if (!local) return undefined;
  // the returns' own dynamic parts belong to the function, not to this request
  const results = local.exprs.map((e) => shapeOf(e, local.ctx, depth + 1, []));
  if (results.every((r) => r.shape.type === "dynamic" || r.shape.type === "unknown")) return undefined;
  return { shape: unionOf(results.map((r) => r.shape)), fromLiteral: false, origin: "call" };
}

/** A constant read through a property (`config.model`, `MODELS.chat`): its static text, as one value. */
function constantShape(u: Expression, ctx: EvalCtx, depth: number): ShapeResult | undefined {
  if (!Node.isPropertyAccessExpression(u) && !Node.isElementAccessExpression(u)) return undefined;
  const text = staticText(evaluate(u, ctx, depth));
  return text !== undefined && text !== "" ? { shape: { type: "string", enum: [text] }, fromLiteral: false, origin: "unknown" } : undefined;
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
    const parts = evaluate(u, ctx);
    const xml = xmlBody(parts);
    if (xml) return { ...xml, encoding: "xml", fromLiteral: true };
    const form = formStringShape(parts);
    if (form) return { shape: form, encoding: "form", dynamic: [], fromLiteral: true };
    return { shape: { type: "string" }, encoding: "raw", dynamic: [], fromLiteral: true };
  }
  const dynamic: DynamicPart[] = [];
  const r = shapeOf(inner, ctx, 0, dynamic);
  // a string held by a variable or a parameter (`body: envelope`): an XML document is read like a literal one
  const held = partsOf(r.shape);
  const xml = held ? xmlBody(held) : undefined;
  if (xml) return { ...xml, encoding: "xml", fromLiteral: true };
  let shape = r.shape;
  if (keys && keys.length > 0 && shape.type === "object") {
    const extra = keysToShape(keys);
    shape = { ...shape, properties: { ...shape.properties, ...(extra.type === "object" ? extra.properties : {}) } };
  }
  if (shape.type === "dynamic" || shape.type === "unknown") dynamic.push({ where: "body", name: "body", origin: originOf(shape) });
  const fromType = shape.type === "object" ? shape.fromType : undefined;
  return { shape, encoding: shape.type === "dynamic" && shape.hint === "Buffer" ? "raw" : enc, dynamic, fromType, fromLiteral: r.fromLiteral };
}
