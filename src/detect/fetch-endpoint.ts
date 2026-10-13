import { Node, SyntaxKind, type CallExpression, type Expression } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import type { FunctionLike } from "../ast/function.js";
import { getProp } from "../ast/object.js";

/**
 * Relay's network layer is a function the app writes (`Network.create(fetchFn)`, #67): the endpoint is the URL of the
 * `fetch` it sends, written in it or in a function it calls (`fetchRelay` calling `fetchGraphQL(text, variables)`).
 * Exactly one `fetch` gives the endpoint; none or several leave it unknown.
 */

export interface FetchEndpoint {
  url?: Expression;
  headers?: Expression;
}

/** Functions read for one network layer, and calls followed from it: bounds on hostile input. */
const MAX_FUNCTIONS = 8;
const MAX_HOPS = 3;
const GLOBALS = new Set(["window", "globalThis", "self"]);

/** The function an expression names: written in place, or a declaration of the project it refers to (imported too). */
function functionOf(e: Expression): FunctionLike | undefined {
  const u = unwrap(e);
  if (Node.isArrowFunction(u) || Node.isFunctionExpression(u)) return u;
  if (!Node.isIdentifier(u)) return undefined;
  const sym = u.getSymbol();
  const target = sym?.isAlias() ? sym.getAliasedSymbol() : sym;
  for (const d of target?.getDeclarations() ?? []) {
    const sf = d.getSourceFile();
    if (sf.isFromExternalLibrary() || sf.isDeclarationFile()) continue;
    if (Node.isFunctionDeclaration(d)) return d;
    const init = Node.isVariableDeclaration(d) ? d.getInitializer() : undefined;
    const value = init && unwrap(init);
    if (value && (Node.isArrowFunction(value) || Node.isFunctionExpression(value))) return value;
  }
  return undefined;
}

/** `fetch(...)`, `window.fetch(...)`, `globalThis.fetch(...)`. */
function isFetch(c: CallExpression): boolean {
  const callee = unwrap(c.getExpression());
  if (Node.isIdentifier(callee)) return callee.getText() === "fetch";
  return Node.isPropertyAccessExpression(callee) && callee.getName() === "fetch" && GLOBALS.has(callee.getExpression().getText());
}

function collect(fn: FunctionLike, out: CallExpression[], seen: Set<FunctionLike>, hops: number): void {
  if (seen.has(fn) || seen.size >= MAX_FUNCTIONS) return;
  seen.add(fn);
  const calls = fn.getDescendantsOfKind(SyntaxKind.CallExpression);
  const own = calls.filter(isFetch);
  out.push(...own);
  if (own.length > 0 || hops >= MAX_HOPS) return;
  for (const c of calls) {
    const inner = functionOf(c.getExpression());
    if (inner) collect(inner, out, seen, hops + 1);
  }
}

/** The URL and headers of the one `fetch` the function `e` names sends; none when it sends none or several. */
export function fetchEndpoint(e: Expression | undefined): FetchEndpoint {
  const fn = e ? functionOf(e) : undefined;
  if (!fn) return {};
  const found: CallExpression[] = [];
  collect(fn, found, new Set(), 0);
  if (found.length !== 1) return {};
  const [url, init] = found[0]!.getArguments() as Expression[];
  return url ? { url, headers: getProp(init, "headers") } : {};
}
