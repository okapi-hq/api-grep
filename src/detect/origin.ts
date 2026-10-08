import { Node, ts, type Identifier, type ImportDeclaration, type Symbol as MorphSymbol } from "ts-morph";

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

/**
 * Module specifier text; undefined when it is not a string literal. `import { x } from y` is a grammar error that
 * ts-morph's `getModuleSpecifierValue()` turns into an exception, which used to stop the whole scan.
 */
function specifierOf(decl: ImportDeclaration | undefined): string | undefined {
  const spec = decl?.compilerNode.moduleSpecifier;
  return spec && ts.isStringLiteral(spec) ? spec.text : undefined;
}

function fromImport(sym: MorphSymbol, decl: Node): IdentOrigin | undefined {
  let spec: string | undefined;
  let importedName: string | undefined;
  if (Node.isImportSpecifier(decl)) {
    spec = specifierOf(decl.getImportDeclaration());
    importedName = decl.getName();
  } else if (Node.isImportClause(decl)) {
    const parent = decl.getParent();
    spec = specifierOf(Node.isImportDeclaration(parent) ? parent : undefined);
    importedName = "default";
  } else if (Node.isNamespaceImport(decl)) {
    spec = specifierOf(decl.getFirstAncestor(Node.isImportDeclaration));
    importedName = "*";
  } else if (Node.isImportEqualsDeclaration(decl)) {
    const ref = decl.getModuleReference();
    if (!Node.isExternalModuleReference(ref)) return undefined;
    const expr = ref.getExpression();
    spec = expr && Node.isStringLiteral(expr) ? expr.getLiteralValue() : undefined;
    importedName = "default";
  } else return undefined;
  if (spec === undefined) return { kind: "unknown" };
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
  // `globalThis` is the one global without a declaration to trace (`window` and `self` are declared in lib.dom)
  if (ident.getText() === "globalThis" && (sym?.getDeclarations().length ?? 0) === 0) return { kind: "global", name: "globalThis" };
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
