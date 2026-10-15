import type { ClassDef, Expr } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { lowerType } from "./composite.js";
import type { GoState } from "./names.js";
import { jsonTag } from "./tags.js";

/** A class of the file for a type name: the struct it declares, or a stub holding the methods of a type declared elsewhere. */
export function classFor(name: string, st: GoState): ClassDef {
  let cls = st.mod.classes.get(name);
  if (!cls) {
    const qname = st.mod.name ? `${st.mod.name}.${name}` : name;
    cls = { name, qname, bases: [], methods: new Map(), fields: new Map(), fieldTypes: new Map(), annotations: [], module: st.mod };
    st.mod.classes.set(name, cls);
  }
  return cls;
}

/** An embedded field (`*openai.Client`, `Base`): its type, whose members the struct has (a base class). */
function embedded(decl: SyntaxNode, cls: ClassDef, order: string[], st: GoState): void {
  const type = lowerType(field(decl, "type"), st);
  if (!type) return;
  cls.bases.push(type);
  order.push(type.k === "attr" || type.k === "name" ? type.name : "");
}

/** A named field: its declared type, and the JSON name a request body built from the struct sends it under. */
function namedFields(decl: SyntaxNode, names: SyntaxNode[], cls: ClassDef, order: string[], st: GoState): void {
  const typeNode = field(decl, "type");
  const type: Expr = lowerType(typeNode, st) ?? { k: "unknown", text: (typeNode?.text ?? "").slice(0, 80) };
  const tag = jsonTag(field(decl, "tag"));
  for (const n of names) {
    order.push(n.text);
    if (type.k !== "unknown") cls.fieldTypes.set(n.text, type);
    // encoding/json sends exported fields, under their tag's name
    if (tag?.skip || (!tag?.name && !/^[A-Z]/.test(n.text))) continue;
    const optional = !!tag?.omitempty || typeNode?.type === "pointer_type";
    cls.annotations.push({ name: tag?.name ?? n.text, type, optional, ...(tag?.name && tag.name !== n.text ? { field: n.text } : {}) });
  }
}

/** `type Client struct { ... }`: a class with its field types, embedded types (bases) and JSON fields. */
export function lowerStruct(spec: SyntaxNode, st: GoState): void {
  const name = field(spec, "name")?.text;
  const type = field(spec, "type");
  if (!name || type?.type !== "struct_type") return;
  const cls = classFor(name, st);
  st.extras.declared.add(cls);
  const order: string[] = [];
  const list = named(type).find((c) => c.type === "field_declaration_list");
  for (const decl of list ? named(list).filter((c) => c.type === "field_declaration") : []) {
    const names = decl.childrenForFieldName("name").filter((c): c is SyntaxNode => !!c);
    if (names.length === 0) embedded(decl, cls, order, st);
    else namedFields(decl, names, cls, order, st);
  }
  st.extras.order.set(cls, order);
}
