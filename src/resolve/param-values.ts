import { Node, SyntaxKind, type CallExpression, type Expression, type NewExpression, type ParameterDeclaration } from "ts-morph";
import { asDefault } from "../model/value-sources.js";
import { isUndefinedLiteral, unwrap } from "../ast/expr.js";
import { declarationsOf, paramSubstitution, toObjectLiteral } from "../ast/object.js";
import type { EvalCtx, Part } from "../types.js";
import { evaluate } from "./evaluate.js";
import { paramValues, type ValueShape } from "./param-shape.js";

/**
 * The values a parameter takes when no wrapper expansion substituted it (#39): the arguments its callers in the project
 * pass, one level up, and its default when some caller leaves it out or nobody calls the function.
 */

/** Callers read per function: past that, a helper called from everywhere, whose values say little. */
const MAX_CALLERS = 20;

type Site = CallExpression | NewExpression;

interface Callers {
  calls: Site[];
  /** The function is also passed as a value (`items.map(fetchOne)`): those calls are not seen. */
  unread: boolean;
}

const callersCache = new WeakMap<Node, Callers>();

/**
 * Whether an object literal is what a variable with no type of its own holds (`const api = { get(id) {...} }`). A
 * literal given a type (an argument, `const h: Handlers = ...`) shares its methods with every literal of that type: a
 * reference search of one (`run` of a framework's `createAction({ ... })`) reaches all of them and types the whole
 * project (hundreds of MB, seconds), for callers that are the library's, not the project's.
 */
function inUntypedVariable(literal: Node): boolean {
  let parent = literal.getParent();
  while (Node.isParenthesizedExpression(parent)) parent = parent.getParent();
  return Node.isVariableDeclaration(parent) && !parent.getTypeNode();
}

/** The identifier callers name the function by: its name, the variable holding it, or the class it constructs. */
function nameNodeOf(fn: Node): Node | undefined {
  if (Node.isMethodDeclaration(fn) && Node.isObjectLiteralExpression(fn.getParent()) && !inUntypedVariable(fn.getParent())) return undefined;
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) return fn.getNameNode();
  if (Node.isConstructorDeclaration(fn)) {
    const cls = fn.getParent();
    return Node.isClassDeclaration(cls) ? cls.getNameNode() : undefined;
  }
  const parent = fn.getParent();
  return (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) && Node.isVariableDeclaration(parent) ? parent.getNameNode() : undefined;
}

/** The call a reference is the callee of: `f(...)`, `new C(...)`, `obj.method(...)`. */
function siteOf(ref: Node): Site | undefined {
  const parent = ref.getParent();
  if ((Node.isCallExpression(parent) || Node.isNewExpression(parent)) && parent.getExpression() === ref) return parent;
  if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === ref) {
    const call = parent.getParent();
    if (Node.isCallExpression(call) && call.getExpression() === parent) return call;
  }
  return undefined;
}

function callersOf(fn: Node): Callers {
  const cached = callersCache.get(fn);
  if (cached) return cached;
  const name = nameNodeOf(fn);
  let refs: Node[] = [];
  try {
    refs = name && Node.isIdentifier(name) ? name.findReferencesAsNodes() : [];
  } catch {
    // the language service failed on this file: no caller is known
  }
  const out: Callers = { calls: [], unread: false };
  for (const ref of refs) {
    const sf = ref.getSourceFile();
    if (sf.isFromExternalLibrary() || sf.isDeclarationFile()) continue;
    const site = siteOf(ref);
    // a recursive call is not a caller: its arguments are the function's own values
    if (site && !site.getFirstAncestor((a) => a === fn)) out.calls.push(site);
    else if (!site && Node.isCallExpression(ref.getParent())) out.unread = true;
  }
  callersCache.set(fn, out);
  return out;
}

/** `undefined` / `null` stand for "not given" (`if (user) params.user = user`): no value. */
const given = (e: Expression | undefined): Expression | undefined => (e && !isUndefinedLiteral(e) && unwrap(e).getKind() !== SyntaxKind.NullKeyword ? e : undefined);

/** What the parameter (or a property destructured from it) is when the parameter is `arg`, or its default. */
function valueFor(decl: Node, param: ParameterDeclaration, arg: Expression | undefined): Expression | undefined | "unread" {
  const value = arg ?? param.getInitializer();
  if (Node.isParameterDeclaration(decl)) return given(value);
  if (!value) return Node.isBindingElement(decl) ? given(decl.getInitializer()) : undefined;
  if (!toObjectLiteral(value)) return "unread";
  return given(paramSubstitution(decl, { subst: new Map([[param, value]]) }).expr);
}

interface Sources {
  sources: Expression[];
  unread: boolean;
  /** The parameter's default among `sources`. */
  fallback?: Expression;
  /** Some caller leaves it out or passes `undefined` / `null`, or nothing calls the function. */
  omitted: boolean;
}

function paramSources(decl: Node, ctx: EvalCtx): Sources | undefined {
  const param = Node.isParameterDeclaration(decl) ? decl : Node.isBindingElement(decl) ? decl.getFirstAncestorByKind(SyntaxKind.Parameter) : undefined;
  const fn = param?.getParent();
  if (ctx.callerLevel || !param || param.isRestParameter() || !fn || Node.isIndexSignatureDeclaration(fn)) return undefined;
  const callers = callersOf(fn);
  const index = fn.getParameters().filter((p) => p.getName() !== "this").indexOf(param);
  const out: Sources = { sources: [], unread: callers.unread || callers.calls.length > MAX_CALLERS, omitted: callers.calls.length === 0 };
  let omitted = callers.calls.length === 0;
  for (const call of callers.calls.slice(0, MAX_CALLERS)) {
    const args = call.getArguments().slice(0, index + 1);
    if (args.some((a) => Node.isSpreadElement(a))) out.unread = true;
    else if (!args[index]) omitted = true;
    else {
      const v = valueFor(decl, param, args[index] as Expression);
      if (v === "unread") out.unread = true;
      else if (v) out.sources.push(v);
      else out.omitted = true;
    }
  }
  if (omitted) out.omitted = true;
  const dflt = omitted ? valueFor(decl, param, undefined) : undefined;
  if (dflt && dflt !== "unread") {
    out.sources.unshift(dflt);
    out.fallback = dflt;
  }
  return out.sources.length > 0 || out.unread ? out : undefined;
}

/**
 * `model ?? "gpt-4o"` where `model` is a parameter every caller gives a value its type says is never `null` /
 * `undefined`: the fallback never runs, so its default is no value the request can send.
 */
export function givenByEveryCaller(value: Expression, ctx: EvalCtx): boolean {
  const u = unwrap(value);
  const decl = Node.isIdentifier(u) ? declarationsOf(u)[0] : undefined;
  const sub = decl ? paramSubstitution(decl, ctx) : undefined;
  if (!decl || !sub?.isParam || sub.expr) return false;
  // without strict null checks a type never says `undefined`: nothing tells the fallback is dead
  const opts = u.getProject().getCompilerOptions();
  if (!(opts.strictNullChecks ?? opts.strict)) return false;
  const found = paramSources(decl, ctx);
  if (!found || found.unread || found.omitted || found.sources.length === 0) return false;
  return found.sources.every((e) => {
    const t = e.getType();
    return !t.isNullable() && !t.isUndefined() && !t.isNull() && !t.isAny() && !t.isUnknown();
  });
}

/** The context a caller's argument is read in: no substitutions, and its parameters stay parameters. */
const callerCtx = (ctx: EvalCtx): EvalCtx => ({ ...(ctx.envHints ? { envHints: ctx.envHints } : {}), ...(ctx.rootDir ? { rootDir: ctx.rootDir } : {}), callerLevel: true });

/** A parameter nobody substituted, as the shape of the values its callers pass and its default. */
export function paramShape(decl: Node, ctx: EvalCtx, shapeOf: (e: Expression, ctx: EvalCtx) => ValueShape, unread: ValueShape): ValueShape {
  const found = paramSources(decl, ctx);
  if (!found) return unread;
  const shapes = found.sources.map((e) => {
    const r = shapeOf(e, callerCtx(ctx));
    return e === found.fallback ? { ...r, shape: asDefault(r.shape) } : r;
  });
  return paramValues(shapes, found.unread, unread);
}

/** A header value that is a parameter: what each source evaluates to, `undefined` for one that cannot be read. */
export function paramAlternatives(value: Expression, ctx: EvalCtx): (Part[] | undefined)[] | undefined {
  const u = unwrap(value);
  const decl = Node.isIdentifier(u) ? declarationsOf(u)[0] : undefined;
  if (!decl || !paramSubstitution(decl, ctx).isParam || paramSubstitution(decl, ctx).expr) return undefined;
  const found = paramSources(decl, ctx);
  if (!found) return undefined;
  const values = found.sources.map((e) => evaluate(e, callerCtx(ctx)));
  return found.unread ? [...values, undefined] : values;
}
