import type { Expr } from "../ir/model.js";
import { pathRef } from "../jvm/paths.js";
import type { SyntaxNode } from "../tree-sitter.js";
import { named, posOf, type JState } from "./state.js";

/** Primitive types as their boxed class, the names body shapes know (`int` -> `Integer`). */
const PRIMITIVES: Record<string, string> = { int: "Integer", long: "Long", short: "Short", byte: "Byte", char: "Char", float: "Float", double: "Double", boolean: "Boolean" };

/** The names of a class type as written (`Request.Builder`, `okhttp3.OkHttpClient`), type arguments and annotations aside. */
export function typePath(n: SyntaxNode): string[] | undefined {
  switch (n.type) {
    case "type_identifier":
    case "identifier":
      return [n.text];
    case "scoped_type_identifier":
    case "scoped_identifier": {
      const parts = named(n).filter((c) => c.type !== "annotation" && c.type !== "marker_annotation").map(typePath);
      return parts.every((p) => p) ? parts.flatMap((p) => p!) : undefined;
    }
    case "generic_type":
      return named(n)[0] ? typePath(named(n)[0]!) : undefined;
    default:
      return undefined;
  }
}

/**
 * A class as written, where it is written: a class nested in the enclosing ones (`Note` inside `NotesApi`) by its
 * qualified name, since only their body sees it by its simple name.
 */
export function typeRef(path: string[], n: SyntaxNode, st: JState | undefined): Expr {
  for (let c = st?.cls; c && path.length > 0; c = c.outer) if (c.types.has(path[0]!)) return pathRef([...c.def.qname.split("."), ...path], posOf(n));
  return pathRef(path, posOf(n));
}

/** A declared type: generics are indexes (`List<Item>`), arrays are `Array<T>`, `var` and `void` are none. */
export function lowerType(n: SyntaxNode | undefined, st?: JState): Expr | undefined {
  if (!n) return undefined;
  switch (n.type) {
    case "integral_type":
    case "floating_point_type":
    case "boolean_type":
      return { k: "name", name: PRIMITIVES[n.text] ?? n.text, pos: posOf(n) };
    case "array_type": {
      const item = lowerType(n.childForFieldName("element") ?? undefined, st);
      return { k: "index", obj: { k: "name", name: "Array", pos: posOf(n) }, key: item ?? { k: "unknown", text: n.text } };
    }
    case "annotated_type":
      return lowerType(named(n).find((c) => c.type !== "annotation" && c.type !== "marker_annotation"), st);
    case "generic_type": {
      const base = lowerType(named(n)[0], st);
      const targs = named(n).find((c) => c.type === "type_arguments");
      if (!base || !targs) return base;
      const items = named(targs).map((t): Expr => lowerType(t, st) ?? { k: "unknown", text: t.text });
      return { k: "index", obj: base, key: items.length === 1 ? items[0]! : { k: "list", items } };
    }
    default: {
      const path = typePath(n);
      return path && !(path.length === 1 && path[0] === "var") ? typeRef(path, n, st) : undefined;
    }
  }
}

/** A class written as an expression (`Api.class`, `Outer.Inner`), else undefined. */
export function classRef(n: SyntaxNode, st: JState): Expr | undefined {
  const path = expressionPath(n) ?? typePath(n);
  return path ? typeRef(path, n, st) : undefined;
}

/** The identifiers of a dotted expression (`a.b.C`), else undefined. */
export function expressionPath(n: SyntaxNode): string[] | undefined {
  if (n.type === "identifier") return [n.text];
  if (n.type !== "field_access") return undefined;
  const obj = n.childForFieldName("object");
  const field = n.childForFieldName("field");
  const head = obj ? expressionPath(obj) : undefined;
  return head && field?.type === "identifier" ? [...head, field.text] : undefined;
}
