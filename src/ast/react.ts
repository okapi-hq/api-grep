import { Node, type CallExpression, type Expression } from "ts-morph";
import { memberChain, unwrap } from "./expr.js";
import { returnsOf } from "./function.js";
import { identifierOrigin } from "./origin.js";

/** Packages whose hooks are React's (`preact/hooks` reads as `preact`). */
const REACT = new Set(["react", "preact"]);

/** `useMemo(...)`, `React.useMemo(...)`: the name of the React hook a call runs, when it is imported from React. */
export function reactHook(call: CallExpression): string | undefined {
  const mc = memberChain(call.getExpression());
  if (!Node.isIdentifier(mc.root) || mc.chain.length > 1) return undefined;
  const origin = identifierOrigin(mc.root);
  if (origin.kind !== "package" || !REACT.has(origin.package)) return undefined;
  if (mc.chain.length === 1) return mc.chain[0];
  return origin.importedName === "default" || origin.importedName === "*" ? undefined : origin.importedName;
}

/**
 * `useMemo(() => value, deps)`: the values the memoized function returns, which the hook hands out as they are (#98).
 * Undefined for any other call.
 */
export function memoized(e: Expression): Expression[] | undefined {
  const u = unwrap(e);
  // the name first: most calls are not hooks, and their origin costs a symbol lookup
  if (!Node.isCallExpression(u) || !/(?:^|\.)useMemo$/.test(u.getExpression().getText()) || reactHook(u) !== "useMemo") return undefined;
  const fn = u.getArguments()[0];
  const f = fn && Node.isExpression(fn) ? unwrap(fn) : undefined;
  return f && (Node.isArrowFunction(f) || Node.isFunctionExpression(f)) ? returnsOf(f) : undefined;
}

/** The one value a memoized expression holds (`useMemo(() => ({ ... }), deps)`), else the expression itself. */
export function memoValue(e: Expression): Expression {
  const values = memoized(e);
  return values?.length === 1 ? values[0]! : e;
}
