import type { ClassDef, Expr } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { type RustState } from "./names.js";
import { lowerType } from "./types.js";

/**
 * `struct` declarations: a class with its fields' types and the names serde serializes them under (`#[serde(rename =
 * "...")]`, the container's `rename_all`, `skip`); a field that may be left out (`Option<T>`, `skip_serializing_if`,
 * `default`) is optional. A tuple struct's fields are `0`, `1`, ... in order.
 */

/** A class of the file for a type name: the struct it declares, or a stub holding the methods of an `impl`. */
export function classFor(name: string, st: RustState): ClassDef {
  let cls = st.mod.classes.get(name);
  if (!cls) {
    cls = { name, qname: `${st.mod.name}.${name}`, bases: [], methods: new Map(), fields: new Map(), fieldTypes: new Map(), annotations: [], module: st.mod };
    st.mod.classes.set(name, cls);
  }
  return cls;
}

const CASES: Record<string, (words: string[]) => string> = {
  lowercase: (w) => w.join(""),
  UPPERCASE: (w) => w.join("").toUpperCase(),
  PascalCase: (w) => w.map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(""),
  camelCase: (w) => w.map((x, i) => (i ? x.charAt(0).toUpperCase() + x.slice(1) : x)).join(""),
  snake_case: (w) => w.join("_"),
  SCREAMING_SNAKE_CASE: (w) => w.join("_").toUpperCase(),
  "kebab-case": (w) => w.join("-"),
  "SCREAMING-KEBAB-CASE": (w) => w.join("-").toUpperCase(),
};

/** A field name under a `rename_all` rule (`max_tokens` -> `maxTokens` for camelCase). */
export function renamed(name: string, rule: string | undefined): string {
  const f = rule ? CASES[rule] : undefined;
  return f ? f(name.split("_").filter(Boolean)) : name;
}

/** What the serde attributes before an item or field say. */
export interface Serde {
  rename?: string;
  renameAll?: string;
  skip: boolean;
  optional: boolean;
}

export function serdeOf(attrs: SyntaxNode[]): Serde {
  const out: Serde = { skip: false, optional: false };
  for (const a of attrs) {
    const text = a.text;
    if (!/^#\[\s*serde\s*\(/.test(text)) continue;
    out.rename = /\brename\s*=\s*"([^"]*)"/.exec(text)?.[1] ?? /\brename\s*\([^)]*\bserialize\s*=\s*"([^"]*)"/.exec(text)?.[1] ?? out.rename;
    out.renameAll = /\brename_all\s*=\s*"([^"]*)"/.exec(text)?.[1] ?? /\brename_all\s*\([^)]*\bserialize\s*=\s*"([^"]*)"/.exec(text)?.[1] ?? out.renameAll;
    if (/\bskip(?:_serializing)?\b(?!_)/.test(text)) out.skip = true;
    if (/\bskip_serializing_if\b|\bdefault\b/.test(text)) out.optional = true;
  }
  return out;
}

const isOption = (n: SyntaxNode | undefined): boolean => n?.type === "generic_type" && /(?:^|::)Option$/.test(field(n, "type")?.text ?? "");

function namedFields(list: SyntaxNode, cls: ClassDef, rule: string | undefined, st: RustState): string[] {
  const order: string[] = [];
  let attrs: SyntaxNode[] = [];
  for (const c of named(list)) {
    if (c.type === "attribute_item") {
      attrs.push(c);
      continue;
    }
    if (c.type !== "field_declaration") continue;
    const name = field(c, "name")?.text;
    const typeNode = field(c, "type");
    const serde = serdeOf(attrs);
    attrs = [];
    if (!name) continue;
    order.push(name);
    const type: Expr = lowerType(typeNode, st) ?? { k: "unknown", text: (typeNode?.text ?? "").slice(0, 80) };
    if (type.k !== "unknown") cls.fieldTypes.set(name, type);
    if (serde.skip) continue;
    const json = serde.rename ?? renamed(name, rule);
    cls.annotations.push({ name: json, type, optional: serde.optional || isOption(typeNode), ...(json !== name ? { field: name } : {}) });
  }
  return order;
}

/** `struct Client { ... }` / `struct Pair(A, B);`: a class with its field types and serde names. */
export function lowerStruct(n: SyntaxNode, attrs: SyntaxNode[], st: RustState): ClassDef | undefined {
  const name = field(n, "name")?.text;
  if (!name) return undefined;
  const cls = classFor(name, st);
  st.extras.declared.add(cls);
  const body = field(n, "body");
  if (body?.type === "field_declaration_list") namedFields(body, cls, serdeOf(attrs).renameAll, st);
  else if (body?.type === "ordered_field_declaration_list") {
    named(body)
      .filter((c) => !c.type.endsWith("comment") && c.type !== "attribute_item" && c.type !== "visibility_modifier")
      .forEach((t, i) => {
        const type = lowerType(t, st);
        if (type) cls.fieldTypes.set(String(i), type);
      });
  }
  return cls;
}
