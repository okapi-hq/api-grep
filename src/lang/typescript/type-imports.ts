import { Node, SyntaxKind, type ImportDeclaration, type SourceFile } from "ts-morph";

/** Per file: the names used somewhere other than a type position, read once. */
const VALUE_NAMES = new WeakMap<SourceFile, Set<string>>();

/** `implements X` and an interface's `extends X` name types only; a class's `extends X` is a value. */
function inTypeHeritage(n: Node): boolean {
  const h = n.getFirstAncestorByKind(SyntaxKind.HeritageClause);
  if (!h) return false;
  return h.getToken() === SyntaxKind.ImplementsKeyword || Node.isInterfaceDeclaration(h.getParent());
}

/** Whether an identifier sits in a type: an annotation, a type alias or interface, `typeof X` in a type, `implements X`. */
function inType(id: Node): boolean {
  for (let cur: Node | undefined = id.getParent(); cur; cur = cur.getParent()) {
    // `class A extends Base<T>` and `make<T>` (an instantiation expression) are values written with type arguments
    if (Node.isExpressionWithTypeArguments(cur)) break;
    if (Node.isTypeNode(cur) || Node.isInterfaceDeclaration(cur) || Node.isTypeAliasDeclaration(cur)) return true;
    if (Node.isStatement(cur) || Node.isSourceFile(cur)) break;
  }
  return inTypeHeritage(id);
}

function valueNames(sf: SourceFile): Set<string> {
  let out = VALUE_NAMES.get(sf);
  if (out) return out;
  out = new Set();
  for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (id.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) continue;
    if (!inType(id)) out.add(id.getText());
  }
  VALUE_NAMES.set(sf, out);
  return out;
}

/**
 * An import whose bindings the file uses as types only (`import { User } from "@supabase/supabase-js"` read in
 * annotations): the compiler drops it, so the package is not loaded at run time. A name also used as a value anywhere in
 * the file (even another binding of that name) keeps the import: when unsure, the package counts as loaded.
 */
export function usedAsTypesOnly(d: ImportDeclaration): boolean {
  const clause = d.getImportClause();
  if (!clause) return false;
  const names = [clause.getDefaultImport(), clause.getNamespaceImport(), ...clause.getNamedImports().filter((n) => !n.isTypeOnly()).map((n) => n.getAliasNode() ?? n.getNameNode())];
  const bound = names.filter((n): n is NonNullable<typeof n> => !!n).map((n) => n.getText());
  const values = valueNames(d.getSourceFile());
  return !bound.some((name) => values.has(name));
}
