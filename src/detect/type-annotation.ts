import { Node, SyntaxKind, type TypeNode } from "ts-morph";
import { identifierOrigin } from "../ast/origin.js";

const WRAPPERS = new Set(["ReturnType", "Awaited", "NonNullable", "Readonly"]);

/** `SupabaseClient`, `SupabaseClient<DB> | null`, `ReturnType<typeof createClient>` -> the identifier naming the type. */
function namedType(node: TypeNode | undefined, depth = 0): Node | undefined {
  if (!node || depth > 4) return undefined;
  if (Node.isParenthesizedTypeNode(node)) return namedType(node.getTypeNode(), depth + 1);
  if (Node.isUnionTypeNode(node)) {
    const kept = node.getTypeNodes().filter((t) => t.getKind() !== SyntaxKind.LiteralType && t.getKind() !== SyntaxKind.UndefinedKeyword);
    return kept.length === 1 ? namedType(kept[0], depth + 1) : undefined;
  }
  if (Node.isTypeQuery(node)) return node.getExprName();
  if (!Node.isTypeReference(node)) return undefined;
  const name = node.getTypeName();
  const text = Node.isIdentifier(name) ? name.getText() : undefined;
  if (text && WRAPPERS.has(text)) return namedType(node.getTypeArguments()[0], depth + 1);
  return name;
}

function leftmostIdentifier(n: Node): Node | undefined {
  let cur: Node = n;
  while (Node.isQualifiedName(cur)) cur = cur.getLeft();
  return Node.isIdentifier(cur) ? cur : undefined;
}

function typeNodeOf(decl: Node): TypeNode | undefined {
  if (Node.isParameterDeclaration(decl) || Node.isPropertyDeclaration(decl) || Node.isPropertySignature(decl) || Node.isVariableDeclaration(decl)) {
    return decl.getTypeNode();
  }
  return undefined;
}

/**
 * Package that the written type annotation of `node`'s declaration comes from. Repositories are scanned without
 * `node_modules`, so `ctx.db.from("t")` with `db: SupabaseClient` has an unresolved (`any`) type; the annotation
 * still names an import from `@supabase/supabase-js`.
 */
export function annotatedPackage(node: Node): string | undefined {
  const sym = node.getSymbol();
  for (const decl of sym?.getDeclarations() ?? []) {
    const named = namedType(typeNodeOf(decl));
    const ident = named ? leftmostIdentifier(named) : undefined;
    if (!ident || !Node.isIdentifier(ident)) continue;
    const origin = identifierOrigin(ident);
    if (origin.kind === "package") return origin.package;
  }
  return undefined;
}

/** Written type of the parameter / property / variable behind `node` (`fetchFn: typeof fetch` gives `typeof fetch`), or "". */
export function writtenType(node: Node): string {
  for (const decl of node.getSymbol()?.getDeclarations() ?? []) {
    const t = typeNodeOf(decl)?.getText();
    if (t) return t;
  }
  return "";
}
