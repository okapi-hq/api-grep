import type { Arg, Entry, Expr, Pos } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { lowerExpr } from "./lower-expr.js";
import { packageOf, posOf, type GoState } from "./names.js";
import { jsonTag } from "./tags.js";

/**
 * Composite literals: a map is a dict, a slice or an array a list, and a struct a call of its type with its fields as
 * named arguments (`openai.ChatCompletionRequest{Model: m}` -> `ChatCompletionRequest(Model=m)`), so a client built
 * this way (`&http.Client{}`) is an instance for the call chains, and the language's `resolveCall` reads a request
 * struct as the dict it serializes to. An anonymous struct is the dict its JSON tags name.
 */

const LISTS = new Set(["slice_type", "array_type", "implicit_length_array_type"]);
const NAMED = new Set(["type_identifier", "qualified_type", "generic_type"]);

/** A type as an expression: `Client`, `openai.Client`, `*Client`, `List[T]`, `[]T`, `map[K]V`; undefined for others. */
export function lowerType(n: SyntaxNode | undefined, st: GoState): Expr | undefined {
  if (!n) return undefined;
  if (n.type === "type_identifier") return { k: "name", name: n.text, pos: posOf(n) };
  if (n.type === "qualified_type") {
    const pkg = field(n, "package")!;
    return { k: "attr", obj: { k: "name", name: pkg.text, pos: posOf(pkg) }, name: field(n, "name")!.text, pos: posOf(n) };
  }
  if (n.type === "pointer_type" || n.type === "parenthesized_type") return lowerType(named(n)[0], st);
  if (n.type === "generic_type") return lowerType(field(n, "type"), st);
  // `[]Message`, `map[string]any`: containers, as the engine's type shapes read them (`ir/types.ts`); `[]byte` is data
  if (n.type === "slice_type" && field(n, "element")?.text === "byte") return { k: "name", name: "bytes", pos: posOf(n) };
  const inner = LISTS.has(n.type) ? field(n, "element") : n.type === "map_type" ? field(n, "value") : undefined;
  if (inner) return { k: "index", obj: { k: "name", name: n.type === "map_type" ? "map" : "[]", pos: posOf(n) }, key: lowerType(inner, st) ?? { k: "unknown", text: inner.text.slice(0, 80) } };
  return undefined;
}

/** The type of a pointer's target: `[]*Message{{...}}` elides `&Message`. */
const deref = (t: SyntaxNode | undefined): SyntaxNode | undefined => (t?.type === "pointer_type" ? named(t)[0] : t);

/** The value of a `literal_element`: an expression, or a literal whose type is elided (`{Role: "user"}` in a slice). */
function elementValue(el: SyntaxNode, hint: SyntaxNode | undefined, st: GoState): Expr {
  const inner = el.type === "literal_element" ? named(el)[0] : el;
  if (!inner) return { k: "unknown", text: "" };
  return inner.type === "literal_value" ? literalValue(inner, deref(hint), st) : lowerExpr(inner, st);
}

interface Element {
  /** A field name (`Model:`) or a key expression (`"k":`), undefined for a positional element. */
  key?: { field?: string; expr?: SyntaxNode };
  value: SyntaxNode;
}

function elements(body: SyntaxNode): Element[] {
  return named(body).flatMap((el): Element[] => {
    if (el.type === "literal_element") return [{ value: el }];
    if (el.type !== "keyed_element") return [];
    const key = field(el, "key");
    const value = field(el, "value");
    const k = key && named(key)[0];
    if (!value || !k) return [];
    return [{ key: k.type === "identifier" || k.type === "field_identifier" ? { field: k.text, expr: k } : { expr: k }, value }];
  });
}

function dict(els: Element[], valueHint: SyntaxNode | undefined, st: GoState, names?: Map<string, string | null>): Expr {
  const entries: Entry[] = [];
  for (const el of els) {
    const value = elementValue(el.value, valueHint, st);
    if (el.key?.field !== undefined && names) {
      const name = names.has(el.key.field) ? names.get(el.key.field) : el.key.field;
      if (name !== null && name !== undefined) entries.push({ key: { k: "str", v: name }, value });
    } else if (el.key?.expr) entries.push({ key: lowerExpr(el.key.expr, st), value });
  }
  return { k: "dict", entries };
}

/** An anonymous struct's fields and the JSON names they serialize to (`null`: never, `json:"-"` or unexported). */
function structNames(type: SyntaxNode): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const list = named(type).find((c) => c.type === "field_declaration_list");
  for (const decl of list ? named(list).filter((c) => c.type === "field_declaration") : []) {
    const tag = jsonTag(field(decl, "tag"));
    for (const name of decl.childrenForFieldName("name").filter((c): c is SyntaxNode => !!c)) {
      out.set(name.text, tag?.skip || (!tag?.name && !/^[A-Z]/.test(name.text)) ? null : (tag?.name ?? name.text));
    }
  }
  return out;
}

/** A struct of a named type: a call of the type, its fields as named arguments (positional ones in order). */
function structCall(type: SyntaxNode, els: Element[], st: GoState, pos: Pos): Expr {
  const fn = lowerType(type, st) ?? { k: "unknown", text: type.text.slice(0, 80) };
  const args: Arg[] = els.map((el) => ({ ...(el.key?.field ? { name: el.key.field } : {}), value: elementValue(el.value, undefined, st) }));
  const local = type.type === "type_identifier" || (type.type === "generic_type" && field(type, "type")?.type === "type_identifier");
  const qualified = type.type === "qualified_type" ? field(type, "package")?.text : undefined;
  // a struct of the project: its fields go to its class (`linkGo`); a library's (`http.Client{...}`) has none there
  if (local || (qualified && packageOf(qualified, st))) {
    const name = fn.k === "name" ? [fn.name] : fn.k === "attr" && fn.obj.k === "name" ? [fn.obj.name, fn.name] : undefined;
    if (name) st.extras.literals.push({ type: name, fields: args.map((a) => ({ name: a.name, value: a.value })), fn: st.fn });
  }
  return { k: "call", fn, args, pos, isNew: true };
}

/** A `literal_value` of the given type (undefined when elided and unknown). */
export function literalValue(body: SyntaxNode, type: SyntaxNode | undefined, st: GoState, at?: SyntaxNode): Expr {
  const els = elements(body);
  const pos = posOf(at ?? body);
  if (type?.type === "map_type") return dict(els, field(type, "value"), st);
  if (type && LISTS.has(type.type)) return { k: "list", items: els.map((el) => elementValue(el.value, field(type, "element"), st)) };
  if (type?.type === "struct_type") return dict(els, undefined, st, structNames(type));
  const keyed = els.some((el) => el.key);
  // a named map type (`url.Values{"k": {"v"}}`, `http.Header{...}`): its keys are expressions, not field names
  if (els.some((el) => el.key && el.key.field === undefined)) return dict(els, undefined, st);
  if (type && NAMED.has(type.type)) return structCall(type, els, st, pos);
  return keyed ? dict(els, undefined, st, new Map()) : { k: "list", items: els.map((el) => elementValue(el.value, undefined, st)) };
}

export function lowerComposite(n: SyntaxNode, st: GoState): Expr {
  const body = field(n, "body");
  return body ? literalValue(body, field(n, "type"), st, n) : { k: "unknown", text: n.text.slice(0, 80), pos: posOf(n) };
}
