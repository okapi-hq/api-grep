import { Node, type CallExpression, type Expression } from "ts-morph";
import type { Callee } from "../types.js";
import { isFunctionLike } from "../wrappers/function.js";
import { unwrap } from "./callee.js";

/** A call the scanner saw but could not follow to an HTTP client. */
export interface Unfollowed {
  node: CallExpression;
  reason: "injected-fetch" | "wrapper-depth";
  expr?: string;
  via?: string;
}

const FETCH_NAME = /fetch/i;
const URL_NAME = /url|uri|href|endpoint|path|link|route/i;
const URL_TEXT = /^(?:https?:)?\/\/|^\//;

function urlLike(arg: Node | undefined): boolean {
  if (!arg || !Node.isExpression(arg)) return false;
  const u = unwrap(arg);
  if (Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u)) return URL_TEXT.test(u.getLiteralValue());
  if (Node.isTemplateExpression(u)) {
    const head = u.getHead().getLiteralText();
    return head ? URL_TEXT.test(head) : urlLike(u.getTemplateSpans()[0]?.getExpression());
  }
  if (Node.isNewExpression(u)) return /^(?:URL|Request)$/.test(u.getExpression().getText());
  if (Node.isBinaryExpression(u)) return urlLike(u.getLeft());
  if (Node.isIdentifier(u)) return URL_NAME.test(u.getText());
  if (Node.isPropertyAccessExpression(u)) return URL_NAME.test(u.getName());
  return false;
}

function returnsResponse(expr: Expression): boolean {
  try {
    const ret = expr.getType().getCallSignatures()[0]?.getReturnType().getText();
    return !!ret && /\bResponse\b/.test(ret);
  } catch {
    return false;
  }
}

/**
 * `this.fetchFn(url)`, `deps.fetchUpstream(url)`: a fetch function received from outside, so its target is not known
 * statically. Only fetch-named callees are considered, and they need a URL-like first argument or a `Response`
 * return type, so `store.fetchUsers()` is not reported.
 */
export function unfollowedFetch(node: CallExpression, callee: Callee): Unfollowed | undefined {
  const runtimePackage = callee.package && !callee.package.startsWith("@types/") && callee.package !== "undici-types";
  if (runtimePackage || callee.global || isFunctionLike(callee.localDecl)) return undefined;
  if (callee.localDecl && (Node.isClassDeclaration(callee.localDecl) || Node.isClassExpression(callee.localDecl))) return undefined;
  const expr = unwrap(node.getExpression() as Expression);
  const name = Node.isIdentifier(expr) ? expr.getText() : Node.isPropertyAccessExpression(expr) ? expr.getName() : undefined;
  if (!name) return undefined;
  // a `Response` return type alone is not enough: route guards return one too (`assertEntitlement(): Promise<Response | null>`)
  if (!FETCH_NAME.test(name)) return undefined;
  const fetchy = urlLike(node.getArguments()[0]) || returnsResponse(expr);
  return fetchy ? { node, reason: "injected-fetch", expr: expr.getText().replace(/\s+/g, "").slice(0, 80) } : undefined;
}
