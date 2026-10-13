import type { Expr } from "../ir/model.js";
import { pathRef } from "../jvm/paths.js";
import { named, type SyntaxNode } from "../tree-sitter.js";
import { posOf } from "./state.js";

/** A declared type: `T?` is `T` (nullable), generics are indexes (`List<Item>`), function types are left out. */
export function lowerType(n: SyntaxNode | undefined): { type?: Expr; nullable: boolean } {
  if (!n) return { nullable: false };
  const inner = named(n).find((c) => c.type !== "type_modifiers");
  switch (n.type) {
    case "nullable_type":
      return { type: lowerType(inner).type, nullable: true };
    case "parenthesized_type":
    case "non_nullable_type":
      return lowerType(inner);
    case "user_type": {
      const base = pathRef(
        named(n)
          .filter((c) => c.type === "identifier")
          .map((c) => c.text),
        posOf(n),
      );
      const targs = named(n).find((c) => c.type === "type_arguments");
      if (!targs) return { type: base, nullable: false };
      const items = named(targs).map((p): Expr => lowerType(named(p).find((c) => c.type !== "variance_modifier")).type ?? { k: "unknown", text: p.text });
      return { type: { k: "index", obj: base, key: items.length === 1 ? items[0]! : { k: "list", items } }, nullable: false };
    }
    default:
      return { nullable: false };
  }
}

/** The identifiers of a dotted expression (`a.b.C`), else undefined. */
function identifiers(n: SyntaxNode): string[] | undefined {
  if (n.type === "identifier") return [n.text];
  if (n.type !== "navigation_expression") return undefined;
  const kids = named(n);
  const head = kids[0] ? identifiers(kids[0]) : undefined;
  const last = kids[kids.length - 1];
  return head && last?.type === "identifier" && kids.length === 2 ? [...head, last.text] : undefined;
}

/** A class written as an expression (`GitHub` in `GitHub::class.java`); undefined when it is not a dotted name. */
export function classRef(n: SyntaxNode): Expr | undefined {
  const path = identifiers(n);
  return path ? pathRef(path, posOf(n)) : undefined;
}
