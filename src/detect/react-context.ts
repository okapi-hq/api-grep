import { Node, SyntaxKind, type CallExpression, type Expression, type JsxOpeningElement, type JsxSelfClosingElement, type VariableDeclaration } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import { reactHook } from "../ast/react.js";
import { declarationOf } from "./client-cache.js";

/**
 * React contexts of the app (#98): `useContext(RpcContext)` (React 19's `use(RpcContext)` too) hands out the `value` of
 * the `<RpcContext.Provider value={...}>` elements the app renders (React 19: `<RpcContext value={...}>`). What the
 * value holds is read by the caller, like any object holding a client; this module only finds the values.
 */

/** Provider elements read per context: bounds on hostile input. */
const MAX_PROVIDERS = 8;

type Element = JsxOpeningElement | JsxSelfClosingElement;

/** The variable `createContext(...)` initializes, when the hook reads one of the app's contexts. */
function contextRead(call: CallExpression): VariableDeclaration | undefined {
  // the name first: most calls are not hooks, and their origin costs a symbol lookup
  if (!/(?:^|\.)use(?:Context)?$/.test(call.getExpression().getText())) return undefined;
  const hook = reactHook(call);
  const arg = hook === "useContext" || hook === "use" ? call.getArguments()[0] : undefined;
  const decl = arg && Node.isIdentifier(arg) ? declarationOf(arg) : undefined;
  const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
  const made = init ? unwrap(init) : undefined;
  return made && Node.isCallExpression(made) && /(?:^|\.)createContext$/.test(made.getExpression().getText()) ? (decl as VariableDeclaration) : undefined;
}

/** `<Ctx.Provider>`, `<Ctx>`: an element whose tag names the context. */
function provides(el: Element, decl: VariableDeclaration): boolean {
  const tag = el.getTagNameNode();
  const root = Node.isPropertyAccessExpression(tag) && tag.getName() === "Provider" ? tag.getExpression() : tag;
  return Node.isIdentifier(root) && declarationOf(root) === decl;
}

/** `value={v}`: undefined when the element gives none the scan can read (no attribute, a spread of props). */
function valueOf(el: Element): Expression | undefined {
  if (el.getAttributes().some((a) => Node.isJsxSpreadAttribute(a))) return undefined;
  const attr = el.getAttribute("value");
  const init = attr && Node.isJsxAttribute(attr) ? attr.getInitializer() : undefined;
  return init && Node.isJsxExpression(init) ? init.getExpression() : undefined;
}

const byContext = new WeakMap<VariableDeclaration, Expression[] | null>();

/** Every value the app's provider elements give the context; null when one cannot be read, or none is rendered. */
function providedValues(decl: VariableDeclaration): Expression[] | null {
  const known = byContext.get(decl);
  if (known !== undefined) return known;
  const name = decl.getName();
  const out: Expression[] = [];
  let readable = true;
  for (const sf of decl.getProject().getSourceFiles()) {
    if (sf.isDeclarationFile() || sf.isFromExternalLibrary()) continue;
    const text = sf.getFullText();
    if (!text.includes(`${name}.Provider`) && !text.includes(`<${name}`)) continue;
    for (const el of [...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement), ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)]) {
      if (!provides(el, decl)) continue;
      const value = valueOf(el);
      if (value && out.length < MAX_PROVIDERS) out.push(value);
      else readable = false;
    }
  }
  const found = readable && out.length > 0 ? out : null;
  byContext.set(decl, found);
  return found;
}

/** The values a `useContext(Ctx)` call may return; undefined for any other call, or a context whose value is not read. */
export function contextValues(call: CallExpression): Expression[] | undefined {
  const decl = contextRead(call);
  return (decl && providedValues(decl)) ?? undefined;
}
