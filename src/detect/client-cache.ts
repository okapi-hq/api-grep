import { Node, SyntaxKind, type CallExpression, type Expression, type NewExpression, type SourceFile, type VariableDeclaration } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import { isFunctionLike, returnsOf, type FunctionLike } from "../ast/function.js";
import { declarationsOf } from "../ast/object.js";
import { memoized } from "../ast/react.js";
import { injectedFunctions } from "./injected-fn.js";

/**
 * Clients kept in a cache and handed out by a helper (#85): `getProvider(chainId)` returns `providers[chainId]`, which
 * it fills with `new JsonRpcProvider(...)` on first use; `cache.get(key)` / `cache.set(key, client)` the same with a
 * `Map`. What such an expression may hold is every value written into the cache, through the helper's returns, the
 * variables it goes through (their initializer and assignments), `??`, `||` and conditionals. The caller decides what
 * those constructions are; a value that cannot be read leaves the whole expression unread.
 */

export type Built = CallExpression | NewExpression;

export interface ClientValues {
  values: Built[];
  /** A cache entry was read with a key known at run time only (`providers[chainId]`). */
  keyed: boolean;
}

/** Nodes visited per expression, and hops through variables and functions: bounds on hostile input. */
const MAX_VISITS = 64;
const MAX_DEPTH = 6;
const ASSIGN = new Set([SyntaxKind.EqualsToken, SyntaxKind.QuestionQuestionEqualsToken, SyntaxKind.BarBarEqualsToken]);

interface Walk {
  left: number;
  seen: Set<Node>;
  keyed: boolean;
  /** A cache was read on the way: a helper that only builds a client is not one (callers handle those). */
  cache: boolean;
}

/** The declaration an identifier names, through an import. */
export function declarationOf(id: Expression): Node | undefined {
  const decl = declarationsOf(id)[0];
  if (decl && (Node.isImportSpecifier(decl) || Node.isImportClause(decl))) return id.getSymbol()?.getAliasedSymbol()?.getDeclarations()[0];
  return decl;
}

/** The variable an identifier names, when it is one (in this file or the one it is imported from). */
function variableOf(id: Expression): VariableDeclaration | undefined {
  const decl = Node.isIdentifier(id) ? declarationOf(id) : undefined;
  return decl && Node.isVariableDeclaration(decl) ? decl : undefined;
}

const sameVariable = (e: Node, decl: Node): boolean => Node.isIdentifier(e) && declarationOf(e) === decl;

/** A file's writes, by the name written to: `v = x` (`assigned`), `v[k] = x` (`entries`), `v.set(k, x)` (`entries`). */
interface Writes {
  assigned: Map<string, [Node, Expression][]>;
  entries: Map<string, [Node, Expression][]>;
}

const writesByFile = new WeakMap<SourceFile, Writes>();

const push = (m: Map<string, [Node, Expression][]>, target: Node, value: Expression): void => {
  const name = target.getText();
  m.set(name, [...(m.get(name) ?? []), [target, value]]);
};

/** One pass per file: the walks look names up rather than scan the file again. */
function writesOf(sf: SourceFile): Writes {
  let w = writesByFile.get(sf);
  if (w) return w;
  w = { assigned: new Map(), entries: new Map() };
  for (const b of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (!ASSIGN.has(b.getOperatorToken().getKind())) continue;
    const left = unwrap(b.getLeft());
    if (Node.isIdentifier(left)) push(w.assigned, left, b.getRight());
    const target = Node.isElementAccessExpression(left) ? unwrap(left.getExpression()) : undefined;
    if (target && Node.isIdentifier(target)) push(w.entries, target, b.getRight());
  }
  for (const c of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = unwrap(c.getExpression());
    const value = c.getArguments()[1];
    const target = Node.isPropertyAccessExpression(callee) && callee.getName() === "set" ? unwrap(callee.getExpression()) : undefined;
    if (target && Node.isIdentifier(target) && value) push(w.entries, target, value as Expression);
  }
  writesByFile.set(sf, w);
  return w;
}

/** Values written into a variable: `v = x`, `v ??= x`, `v ||= x`. */
function assignedValues(decl: VariableDeclaration): Expression[] {
  const found = writesOf(decl.getSourceFile()).assigned.get(decl.getName()) ?? [];
  return found.flatMap(([target, value]) => (sameVariable(target, decl) ? [value] : []));
}

/**
 * Values written into a cache variable: `cache[k] = x` (also `??=`, `||=`), `cache.set(k, x)`, and its initializer's
 * entries (`{ 1: x }`, `new Map([[k, x]])`). Null when nothing is ever written into it.
 */
function cacheWrites(decl: VariableDeclaration): Expression[] | null {
  const found = writesOf(decl.getSourceFile()).entries.get(decl.getName()) ?? [];
  const out = found.flatMap(([target, value]) => (sameVariable(target, decl) ? [value] : []));
  out.push(...initialEntries(decl.getInitializer()));
  return out.length > 0 ? out : null;
}

/** `{ 1: a, 2: b }`, `new Map([[k, a]])`: the values a cache starts with. */
function initialEntries(init: Expression | undefined): Expression[] {
  const u = init ? unwrap(init) : undefined;
  if (u && Node.isObjectLiteralExpression(u)) return u.getProperties().flatMap((p) => (Node.isPropertyAssignment(p) ? [p.getInitializer()!] : []));
  const entries = u && Node.isNewExpression(u) && u.getExpression().getText() === "Map" ? u.getArguments()[0] : undefined;
  if (!entries || !Node.isArrayLiteralExpression(entries)) return [];
  return entries.getElements().flatMap((e) => (Node.isArrayLiteralExpression(e) && e.getElements()[1] ? [e.getElements()[1]!] : []));
}

/** The local function a call runs: `getProvider(id)`, also imported, or a method of this class (`this.getProvider(id)`). */
function localFunction(c: CallExpression): FunctionLike | undefined {
  const callee = unwrap(c.getExpression());
  if (Node.isIdentifier(callee)) {
    const decl = declarationOf(callee);
    const fn = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : decl;
    const u = fn && Node.isExpression(fn) ? unwrap(fn) : fn;
    return isFunctionLike(u) ? u : undefined;
  }
  if (Node.isPropertyAccessExpression(callee) && Node.isThisExpression(callee.getExpression())) {
    const cls = callee.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
    const m = cls?.getMethod(callee.getName());
    return isFunctionLike(m) ? m : undefined;
  }
  return undefined;
}

/** `cache.get(key)`: the cache variable, when the call reads one. */
export function cacheRead(c: CallExpression): VariableDeclaration | undefined {
  const callee = unwrap(c.getExpression());
  return Node.isPropertyAccessExpression(callee) && callee.getName() === "get" ? variableOf(unwrap(callee.getExpression())) : undefined;
}

function fromCache(decl: VariableDeclaration, key: Node | undefined, w: Walk, depth: number): Built[] | undefined {
  w.cache = true;
  if (key && !Node.isStringLiteral(key) && !Node.isNumericLiteral(key) && !Node.isNoSubstitutionTemplateLiteral(key)) w.keyed = true;
  const writes = cacheWrites(decl);
  return writes ? all(writes, w, depth) : undefined;
}

function all(es: Expression[], w: Walk, depth: number): Built[] | undefined {
  const out: Built[] = [];
  for (const e of es) {
    const v = walk(e, w, depth + 1);
    if (!v) return undefined;
    out.push(...v);
  }
  return out;
}

function walkCall(u: CallExpression, w: Walk, depth: number): Built[] | undefined {
  const cache = cacheRead(u);
  if (cache) return fromCache(cache, u.getArguments()[0], w, depth);
  const fn = localFunction(u);
  if (fn) return all(returnsOf(fn), w, depth);
  // `useMemo(() => client, deps)`; `this.getProvider(id)`, the functions a constructor is handed (#98)
  const values = memoized(u) ?? injectedFunctions(u)?.flatMap(returnsOf);
  return values ? all(values, w, depth) : [u];
}

function walkVariable(u: Expression, w: Walk, depth: number): Built[] | undefined {
  const decl = variableOf(u);
  if (!decl) return undefined;
  const init = decl.getInitializer();
  const values = [...(init ? [init] : []), ...assignedValues(decl)];
  return values.length > 0 ? all(values, w, depth) : undefined;
}

function walk(e: Expression, w: Walk, depth: number): Built[] | undefined {
  const u = unwrap(e);
  // a cycle (`let p = cache.get(k); ... cache.set(k, p)`) adds nothing
  if (w.seen.has(u)) return [];
  if (--w.left < 0 || depth > MAX_DEPTH) return undefined;
  w.seen.add(u);
  if (Node.isNewExpression(u)) return [u];
  if (Node.isCallExpression(u)) return walkCall(u, w, depth);
  if (Node.isIdentifier(u)) return walkVariable(u, w, depth);
  if (Node.isElementAccessExpression(u)) {
    const decl = variableOf(unwrap(u.getExpression()));
    return decl ? fromCache(decl, u.getArgumentExpression(), w, depth) : undefined;
  }
  if (Node.isConditionalExpression(u)) return all([u.getWhenTrue(), u.getWhenFalse()], w, depth);
  if (Node.isBinaryExpression(u)) {
    const op = u.getOperatorToken().getKind();
    if (op === SyntaxKind.QuestionQuestionToken || op === SyntaxKind.BarBarToken || op === SyntaxKind.QuestionQuestionEqualsToken || op === SyntaxKind.BarBarEqualsToken) {
      return all([u.getLeft(), u.getRight()], w, depth);
    }
    if (op === SyntaxKind.EqualsToken) return walk(u.getRight(), w, depth + 1);
  }
  return undefined;
}

/**
 * The client constructions an expression may hold, when it reads a cache or calls a helper that does; undefined for
 * anything else (a construction in place, a parameter), or when one of the values cannot be read.
 */
export function cachedClients(e: Expression): ClientValues | undefined {
  const u = unwrap(e);
  const local = Node.isCallExpression(u) && (cacheRead(u) || localFunction(u) || injectedFunctions(u));
  if (!local && !Node.isElementAccessExpression(u) && !Node.isIdentifier(u)) return undefined;
  const w: Walk = { left: MAX_VISITS, seen: new Set(), keyed: false, cache: false };
  const values = walk(u, w, 0);
  if (!values || values.length === 0 || !w.cache) return undefined;
  // the same construction reached twice is one candidate
  return { values: [...new Set(values)], keyed: w.keyed };
}

/**
 * What options built in code may hold (wagmi's `createConfig`, #85), for walks that look for transports: an object
 * literal's values (one per chain) and methods' returns, a function's returns, a spread, a variable reassigned after
 * its declaration (`rpcs = [http(a), ...rpcs]`). Undefined for anything else.
 */
export function innerValues(u: Node): Expression[] | undefined {
  if (Node.isObjectLiteralExpression(u)) {
    return u.getProperties().flatMap((p) => {
      if (Node.isPropertyAssignment(p)) return [p.getInitializer()!];
      if (Node.isShorthandPropertyAssignment(p)) return [p.getNameNode()];
      if (Node.isSpreadAssignment(p)) return [p.getExpression()];
      return Node.isMethodDeclaration(p) ? returnsOf(p) : [];
    });
  }
  if (Node.isArrowFunction(u) || Node.isFunctionExpression(u)) return returnsOf(u);
  if (Node.isSpreadElement(u)) return [u.getExpression()];
  // `transports: buildTransports(chains)`: what the app's helper returns, and what it is given
  const fn = Node.isCallExpression(u) ? localFunction(u) : undefined;
  if (fn && Node.isCallExpression(u)) return [...returnsOf(fn), ...(u.getArguments() as Expression[])];
  const decl = Node.isIdentifier(u) ? variableOf(u) : undefined;
  const assigned = decl ? assignedValues(decl) : [];
  const init = decl?.getInitializer();
  return assigned.length > 0 ? [...(init ? [init] : []), ...assigned] : undefined;
}

/**
 * `urls[chainId]`, `urls.get(chainId)`: a URL picked with a key known at run time. A cache entry built with one depends
 * on the key too, whatever URL the table lists first.
 */
export function pickedByKey(url: Expression | undefined): boolean {
  const u = url ? unwrap(url) : undefined;
  if (!u) return false;
  const key = Node.isElementAccessExpression(u) ? u.getArgumentExpression() : Node.isCallExpression(u) && /\.get$/.test(u.getExpression().getText()) ? u.getArguments()[0] : undefined;
  return !!key && !Node.isStringLiteral(key) && !Node.isNumericLiteral(key) && !Node.isNoSubstitutionTemplateLiteral(key);
}
