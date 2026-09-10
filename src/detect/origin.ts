import { Node, type Identifier, type Symbol as MorphSymbol } from "ts-morph";

export type IdentOrigin =
  | { kind: "package"; package: string; importedName: string }
  | { kind: "global"; name: string }
  | { kind: "local"; decl: Node }
  | { kind: "unknown" };

const NODE_BUILTINS = new Set(["http", "https", "http2", "fs", "path", "url", "crypto", "os", "child_process", "stream", "buffer", "events"]);

/** Bare module specifier -> package root name; relative / alias paths -> null. */
export function packageFromSpecifier(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("~") || spec.startsWith("@/")) return null;
  const s = spec.startsWith("node:") ? spec.slice(5) : spec;
  const segs = s.split("/");
  if (s.startsWith("@")) return segs.length >= 2 ? `${segs[0]}/${segs[1]}` : s;
  const root = segs[0] ?? s;
  if (NODE_BUILTINS.has(root)) return root;
  return root;
}

export function packageFromFilePath(fp: string): string | undefined {
  const idx = fp.lastIndexOf("/node_modules/");
  if (idx < 0) return undefined;
  const rest = fp.slice(idx + "/node_modules/".length).split("/");
  if (rest[0] === "typescript" || rest[0] === "@types") return rest[0] === "@types" ? `@types/${rest[1] ?? ""}` : undefined;
  if (rest[0]?.startsWith("@")) return `${rest[0]}/${rest[1] ?? ""}`;
  return rest[0];
}

function isProjectDecl(decl: Node): boolean {
  const sf = decl.getSourceFile();
  return !sf.isFromExternalLibrary() && !sf.isDeclarationFile() && !sf.getFilePath().includes("/node_modules/");
}

function fromImport(sym: MorphSymbol, decl: Node): IdentOrigin | undefined {
  let spec: string | undefined;
  let importedName: string | undefined;
  if (Node.isImportSpecifier(decl)) {
    spec = decl.getImportDeclaration().getModuleSpecifierValue();
    importedName = decl.getName();
  } else if (Node.isImportClause(decl)) {
    const parent = decl.getParent();
    spec = Node.isImportDeclaration(parent) ? parent.getModuleSpecifierValue() : undefined;
    importedName = "default";
  } else if (Node.isNamespaceImport(decl)) {
    const importDecl = decl.getFirstAncestor(Node.isImportDeclaration);
    spec = importDecl?.getModuleSpecifierValue();
    importedName = "*";
  } else if (Node.isImportEqualsDeclaration(decl)) {
    const ref = decl.getModuleReference();
    spec = Node.isExternalModuleReference(ref) ? ref.getExpression()?.getText().slice(1, -1) : undefined;
    importedName = "default";
  }
  if (spec === undefined) return undefined;
  // tsconfig `paths` aliases (`@app/lib/x`, `~/utils`) look like packages: trust the resolved target first.
  const target = sym.getAliasedSymbol()?.getDeclarations()[0];
  if (target && isProjectDecl(target)) return { kind: "local", decl: target };
  const pkg = packageFromSpecifier(spec);
  if (pkg) return { kind: "package", package: pkg, importedName: importedName ?? "default" };
  if (target) {
    const p = packageFromFilePath(target.getSourceFile().getFilePath());
    if (p) return { kind: "package", package: p, importedName: importedName ?? "default" };
  }
  return { kind: "unknown" };
}

function fromRequire(decl: Node): IdentOrigin | undefined {
  if (!Node.isVariableDeclaration(decl) && !Node.isBindingElement(decl)) return undefined;
  const varDecl = Node.isVariableDeclaration(decl) ? decl : decl.getFirstAncestor(Node.isVariableDeclaration);
  const init = varDecl?.getInitializer();
  if (!init || !Node.isCallExpression(init)) return undefined;
  if (init.getExpression().getText() !== "require") return undefined;
  const arg = init.getArguments()[0];
  if (!arg || !Node.isStringLiteral(arg)) return undefined;
  const pkg = packageFromSpecifier(arg.getLiteralValue());
  if (!pkg) return undefined;
  const importedName = Node.isBindingElement(decl) ? (decl.getPropertyNameNode()?.getText() ?? decl.getName()) : "default";
  return { kind: "package", package: pkg, importedName };
}

export function identifierOrigin(ident: Identifier): IdentOrigin {
  const sym = ident.getSymbol();
  if (!sym) return { kind: "unknown" };
  for (const decl of sym.getDeclarations()) {
    const imp = fromImport(sym, decl);
    if (imp) return imp;
    const req = fromRequire(decl);
    if (req) return req;
    if (isProjectDecl(decl)) return { kind: "local", decl };
    const sf = decl.getSourceFile();
    if (sf.isDeclarationFile() || sf.isFromExternalLibrary()) {
      const pkg = packageFromFilePath(sf.getFilePath());
      if (pkg && !pkg.startsWith("@types/")) return { kind: "package", package: pkg, importedName: ident.getText() };
      return { kind: "global", name: ident.getText() };
    }
  }
  return { kind: "unknown" };
}
