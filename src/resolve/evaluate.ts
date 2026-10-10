import { Node, SyntaxKind, type CallExpression, type ElementAccessExpression, type Expression, type PropertyAccessExpression, type VariableDeclaration } from "ts-morph";
import { classPropertyInitializer } from "../ast/class.js";
import { constructedName, unwrap } from "../ast/expr.js";
import { isFunctionLike } from "../ast/function.js";
import { bindingElementValue, declarationsOf, getProp, paramSubstitution, propertyValue, toObjectLiteral } from "../ast/object.js";
import { identifierOrigin } from "../ast/origin.js";
import { SCHEME_RE } from "../normalize/path.js";
import type { DynamicOrigin, EvalCtx, Part, Shape } from "../types.js";
import { localReturn } from "./local-return.js";
import { hasStaticHost, markConst, partsToTemplate, pickBranch, replaceInParts, staticText } from "./parts.js";
import { typeToShape } from "./type-shape.js";

export { partsToTemplate, staticText } from "./parts.js";

/**
 * Steps followed to resolve one value: a variable's initializer, a wrapper parameter's argument, a property, a helper's
 * return. A `+` chain and template spans cost nothing: a URL four wrappers away from its literal still resolves.
 */
const MAX_DEPTH = 10;
const PASSTHROUGH_CALLS = new Set(["encodeURIComponent", "encodeURI", "String", "toString", "trim", "trimEnd", "trimStart", "toLowerCase", "toUpperCase"]);

function dynamicName(e: Expression): string {
  const u = unwrap(e);
  if (Node.isIdentifier(u)) return u.getText();
  if (Node.isPropertyAccessExpression(u)) return u.getName();
  if (Node.isElementAccessExpression(u)) return dynamicName(u.getExpression());
  if (Node.isCallExpression(u)) return dynamicName(u.getExpression());
  if (Node.isConditionalExpression(u)) return dynamicName(u.getWhenTrue());
  return "expr";
}

const SHALLOW = 4;

/**
 * Checker shape of a dynamic expression; omitted when the checker knows nothing useful.
 * Only identifiers and member accesses are typed (call signatures are costly to resolve) and only shallowly:
 * path / query values are scalars, and deep object types would pin large checker caches on big repos.
 */
export function exprShape(e: Expression): Shape | undefined {
  const u = unwrap(e);
  if (!Node.isIdentifier(u) && !Node.isPropertyAccessExpression(u) && !Node.isElementAccessExpression(u)) return undefined;
  try {
    const s = typeToShape(u.getType(), u, SHALLOW).shape;
    return s.type === "unknown" ? undefined : s;
  } catch {
    return undefined;
  }
}

function dyn(e: Expression, origin: DynamicOrigin): Part[] {
  const shape = exprShape(e);
  return [{ kind: "dynamic", name: dynamicName(e), origin, ...(shape ? { shape } : {}) }];
}

function envName(u: Expression): string | undefined {
  // process.env.X / process.env["X"] / import.meta.env.X
  const isEnvObj = (o: Expression): boolean => {
    const t = o.getText().replace(/\s/g, "");
    return t === "process.env" || t === "import.meta.env" || t === "Deno.env" || t === "globalThis.process.env";
  };
  if (Node.isPropertyAccessExpression(u) && isEnvObj(u.getExpression())) return u.getName();
  if (Node.isElementAccessExpression(u) && isEnvObj(u.getExpression())) {
    const a = u.getArgumentExpression();
    if (a && Node.isStringLiteral(a)) return a.getLiteralValue();
  }
  if (Node.isCallExpression(u) && u.getExpression().getText() === "Deno.env.get") {
    const a = u.getArguments()[0];
    if (a && Node.isStringLiteral(a)) return a.getLiteralValue();
  }
  return undefined;
}

/** `const owner = getParam("owner")` reads better as `{owner}` than `{getParam}`: a lone call-named part takes the variable's name. */
function renameSingleDynamic(parts: Part[], ident: Expression): Part[] {
  const only = parts.length === 1 ? parts[0] : undefined;
  if (!only || only.kind !== "dynamic" || (only.origin !== "call" && only.name !== "expr")) return parts;
  return [{ ...only, name: ident.getText(), shape: only.shape ?? exprShape(ident) }];
}

function evalIdentifier(u: Expression, ctx: EvalCtx, depth: number): Part[] {
  for (const decl of declarationsOf(u)) {
    const sub = paramSubstitution(decl, ctx);
    if (sub.isParam) return sub.expr ? evaluate(sub.expr, ctx, depth + 1) : paramDefault(decl, u, ctx, depth);
    if (Node.isVariableDeclaration(decl)) {
      const init = decl.getInitializer();
      if (init) return renameSingleDynamic(markConst(evaluate(init, ctx, depth + 1)), u);
      const values = assignedValues(decl).map((v) => evaluate(v, ctx, depth + 1));
      return values.find(hasStaticHost) ?? dyn(u, "unknown");
    }
    if (Node.isEnumMember(decl)) {
      const v = decl.getValue();
      if (typeof v === "string" || typeof v === "number") return [{ kind: "static", text: String(v), viaConst: true }];
    }
    const bound = bindingElementValue(decl, ctx);
    if (bound) return markConst(evaluate(bound, ctx, depth + 1));
  }
  const exported = commonJsExport(u, ctx, depth);
  return exported ?? typeLiteral(u) ?? dyn(u, "unknown");
}

/** `let url; if (full) url = path; else url = \`https://...${path}\`;`: the values assigned to a variable declared bare. */
function assignedValues(decl: VariableDeclaration): Expression[] {
  const scope = decl.getFirstAncestor((a) => isFunctionLike(a)) ?? decl.getSourceFile();
  const name = decl.getName();
  return scope.getDescendantsOfKind(SyntaxKind.BinaryExpression).flatMap((b) => {
    const left = b.getLeft();
    const own = b.getOperatorToken().getKind() === SyntaxKind.EqualsToken && Node.isIdentifier(left) && left.getText() === name && declarationsOf(left)[0] === decl;
    return own ? [b.getRight()] : [];
  });
}

/** `config` in `config.base` is a module: `const config = require("./config")`. */
function fromRequiredModule(obj: Expression): boolean {
  const decl = Node.isIdentifier(obj) ? obj.getSymbol()?.getDeclarations()[0] : undefined;
  const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
  return !!init && Node.isCallExpression(init) && init.getExpression().getText() === "require";
}

/**
 * A CommonJS export the checker links to its definition: `const { BASE } = require("./config")` or `config.base` with
 * `module.exports = { BASE: "https://..." }` in a project file.
 */
function commonJsExport(u: Expression, ctx: EvalCtx, depth: number): Part[] | undefined {
  const sym = u.getSymbol();
  const target = sym?.isAlias() ? sym.getAliasedSymbol() : sym;
  for (const decl of target?.getDeclarations() ?? []) {
    if (decl.getSourceFile().isFromExternalLibrary() || decl.getSourceFile().isDeclarationFile()) continue;
    const init = Node.isPropertyAssignment(decl) || Node.isVariableDeclaration(decl) ? decl.getInitializer() : Node.isShorthandPropertyAssignment(decl) ? decl.getNameNode() : undefined;
    if (init && init !== u) return markConst(evaluate(init, ctx, depth + 1));
  }
  return undefined;
}

/** A parameter nobody substituted: its literal default (`baseUrl = "https://api.gladia.io"`) is the best static guess. */
function paramDefault(decl: Node, u: Expression, ctx: EvalCtx, depth: number): Part[] {
  const init = Node.isParameterDeclaration(decl) || Node.isBindingElement(decl) ? decl.getInitializer() : undefined;
  const parts = init ? evaluate(init, ctx, depth + 1) : undefined;
  return parts && staticText(parts) !== undefined ? markConst(parts) : dyn(u, "param");
}

function typeLiteral(u: Expression): Part[] | undefined {
  try {
    const t = u.getType();
    const v = t.isStringLiteral() || t.isNumberLiteral() ? t.getLiteralValue() : undefined;
    if (typeof v === "string" || typeof v === "number") return [{ kind: "static", text: String(v), viaConst: true }];
  } catch {
    return undefined;
  }
  return undefined;
}

/** `HttpMethod.POST` from a package whose types are not installed: an ALL_CAPS member of an imported enum reads as its own name. */
function packageEnumMember(u: Expression): Part[] | undefined {
  if (!Node.isPropertyAccessExpression(u)) return undefined;
  const obj = unwrap(u.getExpression());
  const name = u.getName();
  if (!Node.isIdentifier(obj) || !/^[A-Z][A-Z0-9_]*$/.test(name) || !/^[A-Z]/.test(obj.getText())) return undefined;
  const origin = identifierOrigin(obj);
  if (origin.kind !== "package") return undefined;
  return [{ kind: "static", text: name, viaConst: true }];
}

function evalPropertyAccess(u: Expression, ctx: EvalCtx, depth: number): Part[] {
  const env = envName(u);
  if (env) return [{ kind: "env", name: env }];
  const member = typeLiteral(u) ?? packageEnumMember(u);
  if (member) return member;
  if (Node.isPropertyAccessExpression(u) && (u.getName() === "href" || u.getName() === "toString")) {
    return evaluate(u.getExpression(), ctx, depth + 1);
  }
  if (Node.isPropertyAccessExpression(u) && Node.isThisExpression(u.getExpression())) {
    const init = classPropertyInitializer(u, u.getName());
    if (init) return markConst(evaluate(init, ctx, depth + 1));
    return typeLiteral(u) ?? dyn(u, "unknown");
  }
  if (Node.isPropertyAccessExpression(u)) {
    // the object hops (spreads, arguments) have a budget of their own: an object passed down two wrappers still resolves
    const inner = getProp(u.getExpression(), u.getName(), ctx);
    if (inner) return markConst(evaluate(inner, ctx, depth + 1));
    const objDecl = Node.isIdentifier(u.getExpression()) ? u.getExpression().getSymbol()?.getDeclarations()[0] : undefined;
    if (objDecl && Node.isParameterDeclaration(objDecl)) return typeLiteral(u) ?? dyn(u, "param");
    const exported = fromRequiredModule(u.getExpression()) ? commonJsExport(u, ctx, depth) : undefined;
    if (exported) return exported;
  }
  if (Node.isElementAccessExpression(u)) {
    const entry = evalElementAccess(u, ctx, depth);
    if (entry) return entry;
  }
  return typeLiteral(u) ?? dyn(u, "unknown");
}

/** `PRESETS["openai"]` reads that entry; `HOSTS[region]` with an unknown key the first entry with a literal host. */
function evalElementAccess(u: ElementAccessExpression, ctx: EvalCtx, depth: number): Part[] | undefined {
  const arg = u.getArgumentExpression();
  const key = arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) ? arg.getLiteralValue() : undefined;
  if (key !== undefined) {
    const inner = getProp(u.getExpression(), key, ctx);
    return inner ? markConst(evaluate(inner, ctx, depth + 1)) : undefined;
  }
  for (const member of toObjectLiteral(u.getExpression(), ctx)?.getProperties() ?? []) {
    const value = propertyValue(member);
    const parts = value ? evaluate(value, ctx, depth + 1) : undefined;
    if (parts && hasStaticHost(parts)) return markConst(parts);
  }
  return undefined;
}

function evalCall(u: Expression, ctx: EvalCtx, depth: number): Part[] {
  const env = envName(u);
  if (env) return [{ kind: "env", name: env }];
  if (!Node.isCallExpression(u)) return dyn(u, "call");
  const callee = u.getExpression();
  const name = Node.isPropertyAccessExpression(callee) ? callee.getName() : callee.getText();
  if (PASSTHROUGH_CALLS.has(name)) {
    const target = Node.isPropertyAccessExpression(callee) && name !== "String" ? callee.getExpression() : u.getArguments()[0];
    if (target && Node.isExpression(target)) return evaluate(target, ctx, depth + 1);
  }
  if (name === "join" && Node.isPropertyAccessExpression(callee)) {
    const arr = unwrap(callee.getExpression());
    const sep = u.getArguments()[0];
    if (Node.isArrayLiteralExpression(arr) && sep && Node.isStringLiteral(sep)) {
      const s = sep.getLiteralValue();
      return arr.getElements().flatMap((el, i) => [...(i ? [{ kind: "static", text: s } as Part] : []), ...evaluate(el, ctx, depth + 1)]);
    }
  }
  if ((name === "replace" || name === "replaceAll") && Node.isPropertyAccessExpression(callee)) {
    const replaced = evalReplace(u, callee, ctx, depth);
    if (replaced) return replaced;
  }
  return helperResult(u, ctx, depth) ?? typeLiteral(u) ?? dyn(u, "call");
}

/**
 * `s.replace("{basin}", basin)` / `.replaceAll(...)`: a literal pattern is swapped in the static text. A regex is never run
 * on the scanned code's behalf: the string stays as it is (trimming a trailing slash does not move the host).
 */
function evalReplace(u: CallExpression, callee: PropertyAccessExpression, ctx: EvalCtx, depth: number): Part[] | undefined {
  const [pattern, replacement] = u.getArguments() as Expression[];
  if (!pattern || !replacement) return undefined;
  const p = unwrap(pattern);
  const literal = Node.isStringLiteral(p) || Node.isNoSubstitutionTemplateLiteral(p);
  if (!literal && !Node.isRegularExpressionLiteral(p)) return undefined;
  const receiver = evaluate(callee.getExpression(), ctx, depth + 1);
  if (!literal) return receiver;
  return replaceInParts(receiver, p.getLiteralValue(), evaluate(replacement, ctx, depth + 1), callee.getName() === "replaceAll");
}

/**
 * What a project URL helper returns, when that says more than the call itself (some static text or an env var). Of
 * several returns (`if (eu) return EU_URL; return URL;`), the first with a literal host, as for a conditional.
 */
function helperResult(u: Expression, ctx: EvalCtx, depth: number): Part[] | undefined {
  const local = localReturn(u, ctx);
  if (!local) return undefined;
  const results = local.exprs
    .map((e) => evaluate(e, local.ctx, depth + 1))
    .filter((parts) => parts.some((p) => p.kind === "env" || (p.kind === "static" && p.text !== "")));
  return results.find(hasStaticHost) ?? results[0];
}

function evalTemplate(u: Expression, ctx: EvalCtx, depth: number): Part[] {
  if (!Node.isTemplateExpression(u)) return [];
  const parts: Part[] = [{ kind: "static", text: u.getHead().getLiteralText() }];
  for (const span of u.getTemplateSpans()) {
    parts.push(...evaluate(span.getExpression(), ctx, depth));
    parts.push({ kind: "static", text: span.getLiteral().getLiteralText() });
  }
  return parts;
}

/**
 * `a ?? "https://host"` / `a || ...`: an env var on the left wins (it can override) but keeps the literal right side
 * as its default host; a left side known statically (`method ?? "GET"` given "POST" through a wrapper) is what runs;
 * an empty default (`id ?? ""`) says nothing, the left side stays; any other left side gives way to the right side.
 */
function evalDefault(left: Expression, right: Expression, ctx: EvalCtx, depth: number): Part[] {
  const l = evaluate(left, ctx, depth + 1);
  const r = evaluate(right, ctx, depth + 1);
  const env = l.findIndex((p) => p.kind === "env");
  if (env < 0) return staticText(l) || staticText(r) === "" ? l : r;
  const fallback = staticText(r);
  if (fallback === undefined) return l;
  return l.map((p, i) => (i === env && p.kind === "env" ? { ...p, fallback } : p));
}

/** The operands of `a + b + c`, left to right, read in a loop: a long concatenation is not a deep recursion. */
function plusOperands(u: Expression): Expression[] {
  const right: Expression[] = [];
  let cur = u;
  while (Node.isBinaryExpression(cur) && cur.getOperatorToken().getKind() === SyntaxKind.PlusToken) {
    right.push(cur.getRight());
    cur = unwrap(cur.getLeft());
  }
  return [cur, ...right.reverse()];
}

/** Evaluates a string-ish expression into static / env / dynamic parts. */
export function evaluate(expr: Expression, ctx: EvalCtx = {}, depth = 0): Part[] {
  const u = unwrap(expr);
  if (depth > MAX_DEPTH) return dyn(u, "unknown");
  if (Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u)) return [{ kind: "static", text: u.getLiteralValue() }];
  if (Node.isNumericLiteral(u)) return [{ kind: "static", text: String(u.getLiteralValue()) }];
  if (Node.isTemplateExpression(u)) return evalTemplate(u, ctx, depth);
  if (Node.isBinaryExpression(u)) {
    const op = u.getOperatorToken().getKind();
    if (op === SyntaxKind.PlusToken) return plusOperands(u).flatMap((o) => evaluate(o, ctx, depth));
    if (op === SyntaxKind.QuestionQuestionToken || op === SyntaxKind.BarBarToken) return evalDefault(u.getLeft(), u.getRight(), ctx, depth);
    return dyn(u, "unknown");
  }
  if (Node.isIdentifier(u)) return evalIdentifier(u, ctx, depth);
  if (Node.isPropertyAccessExpression(u) || Node.isElementAccessExpression(u)) return evalPropertyAccess(u, ctx, depth);
  if (Node.isCallExpression(u)) return evalCall(u, ctx, depth);
  if (constructedName(u) === "URL") return evalNewUrl(u, ctx, depth);
  if (Node.isConditionalExpression(u)) return pickBranch(evaluate(u.getWhenTrue(), ctx, depth + 1), evaluate(u.getWhenFalse(), ctx, depth + 1)) ?? dyn(u, "unknown");
  return dyn(u, "unknown");
}

/** `new URL(path, base)`: absolute path wins; a leading-slash path replaces the base path. */
export function evalNewUrl(u: Expression, ctx: EvalCtx, depth: number): Part[] {
  if (!Node.isNewExpression(u)) return dyn(u, "unknown");
  const [a, b] = u.getArguments() as Expression[];
  if (!a) return dyn(u, "unknown");
  const pathParts = evaluate(a, ctx, depth + 1);
  const pathText = partsToTemplate(pathParts);
  if (!b || SCHEME_RE.test(pathText)) return pathParts;
  const baseParts = evaluate(b, ctx, depth + 1);
  if (pathText.startsWith("/")) return [...originOnly(baseParts), ...pathParts];
  const baseText = partsToTemplate(baseParts);
  const sep: Part[] = baseText.endsWith("/") || pathText.startsWith("?") ? [] : [{ kind: "static", text: "/" }];
  return [...baseParts, ...sep, ...pathParts];
}

function originOnly(parts: Part[]): Part[] {
  const text = partsToTemplate(parts);
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/i.exec(text);
  if (m && staticText(parts) !== undefined) return [{ kind: "static", text: m[1]!, viaConst: parts.some((p) => p.kind === "static" && p.viaConst) }];
  if (parts[0] && parts[0].kind !== "static") return [parts[0]];
  return parts;
}
