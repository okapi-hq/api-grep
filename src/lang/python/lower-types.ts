import type { Expr, Param } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { lowerExpr, posOf, type PyState } from "./lower-expr.js";

const OPTIONAL_TYPES = new Set(["Optional", "NotRequired"]);
const WRAPPER_TYPES = new Set(["Annotated", "Required", "ClassVar", "Final", "ReadOnly"]);

/** A type annotation as an expression: `Optional[X]`, `X | None`, `Annotated[X, ...]` and `"X"` give `X`. */
export function lowerType(n: SyntaxNode | undefined, st: PyState): { type?: Expr; optional: boolean } {
  if (!n) return { optional: false };
  if (n.type === "type" || n.type === "parenthesized_expression") return lowerType(named(n)[0], st);
  if (n.type === "string") return { type: { k: "name", name: n.text.replace(/^[a-z]*["']+|["']+$/gi, "").trim(), pos: posOf(n) }, optional: false };
  if (n.type === "binary_operator" && field(n, "operator")?.text === "|") {
    const parts = [field(n, "left"), field(n, "right")].filter((p): p is SyntaxNode => !!p && p.type !== "none");
    return { type: lowerType(parts[0], st).type, optional: parts.length < 2 || /\bNone\b/.test(n.text) };
  }
  if (n.type === "generic_type" || n.type === "subscript") return lowerGeneric(n, st);
  return { type: lowerExpr(n, st), optional: n.type === "none" };
}

function lowerGeneric(n: SyntaxNode, st: PyState): { type?: Expr; optional: boolean } {
  const head = named(n)[0]!.text;
  const params = n.type === "generic_type" ? named(named(n)[1] ?? n).filter((c) => c.type === "type") : [field(n, "subscript")].filter((c): c is SyntaxNode => !!c);
  const members = params.filter((p) => p.text !== "None");
  if (OPTIONAL_TYPES.has(head) || (head === "Union" && members.length < params.length)) return { type: lowerType(members[0], st).type, optional: true };
  if (WRAPPER_TYPES.has(head)) return lowerType(params[0], st);
  const items = params.map((p): Expr => lowerType(p, st).type ?? { k: "unknown", text: p.text });
  return { type: { k: "index", obj: lowerExpr(named(n)[0]!, st), key: items.length === 1 ? items[0]! : { k: "list", items } }, optional: false };
}

/** Parameters; a method's first one (`self`, `cls`) is its receiver, not a parameter. */
export function lowerParams(n: SyntaxNode | undefined, st: PyState, dropReceiver: boolean): { params: Param[]; receiver?: string } {
  const params: Param[] = [];
  let receiver: string | undefined;
  for (const c of n ? named(n) : []) {
    if (c.type === "keyword_separator" || c.type === "positional_separator" || c.type === "comment") continue;
    const nameNode = c.type === "identifier" ? c : (field(c, "name") ?? named(c).find((x) => x.type === "identifier"));
    const name = nameNode?.text;
    if (!name) continue;
    if (dropReceiver && receiver === undefined && params.length === 0 && (c.type === "identifier" || c.type === "typed_parameter")) {
      receiver = name;
      continue;
    }
    const kind = c.type === "list_splat_pattern" ? "varargs" : c.type === "dictionary_splat_pattern" ? "kwargs" : "normal";
    const dflt = field(c, "value");
    const type = lowerType(field(c, "type") ?? named(c).find((x) => x.type === "type"), st).type;
    params.push({ name, index: params.length, kind, ...(dflt ? { default: lowerExpr(dflt, st) } : {}), ...(type ? { type } : {}) });
  }
  return { params, receiver };
}

export function decoratorNames(n: SyntaxNode): string[] {
  return named(n)
    .filter((c) => c.type === "decorator")
    .map((d) => named(d)[0]?.text ?? "");
}
