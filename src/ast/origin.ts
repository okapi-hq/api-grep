import { Node, ts, type CallExpression, type ExportDeclaration, type Identifier, type ImportDeclaration, type Symbol as MorphSymbol, type Type } from "ts-morph";

export type IdentOrigin =
  | { kind: "package"; package: string; importedName: string }
  | { kind: "global"; name: string }
  | { kind: "local"; decl: Node }
  | { kind: "unknown" };

const CDN_RE =
  /^https?:\/\/(?:cdn\.jsdelivr\.net\/npm\/|unpkg\.com\/|esm\.sh\/(?:v\d+\/)?|cdn\.skypack\.dev\/|esm\.run\/|ga\.jspm\.io\/npm:|cdnjs\.cloudflare\.com\/ajax\/libs\/)(@[^/@]+\/[^/@?#]+|[^/@?#]+)/i;

/** The npm package a CDN URL serves (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`, `https://esm.sh/stripe@14`). */
export function packageFromCdnUrl(url: string): string | undefined {
  return CDN_RE.exec(url.trim())?.[1]?.toLowerCase();
}

/** Bare module specifier -> package root name (`node:https` -> `https`, also `npm:stripe@14` and CDN URLs); relative / alias paths -> null. */
export function packageFromSpecifier(spec: string): string | null {
  if (/^https?:\/\//i.test(spec)) return packageFromCdnUrl(spec) ?? null;
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("~") || spec.startsWith("@/") || spec.startsWith("jsr:")) return null;
  const s = spec.startsWith("node:") ? spec.slice(5) : spec.startsWith("npm:") ? spec.slice(4) : spec;
  const segs = s.split("/");
  // `npm:stripe@14` / `npm:@supabase/supabase-js@2`: the version is not part of the name
  const unversioned = (name: string): string => name.replace(/(.)@.*$/, "$1");
  if (s.startsWith("@")) return segs.length >= 2 ? `${segs[0]}/${unversioned(segs[1]!)}` : s;
  return unversioned(segs[0] ?? s);
}

export function packageFromFilePath(fp: string): string | undefined {
  const idx = fp.lastIndexOf("/node_modules/");
  if (idx < 0) return undefined;
  const rest = fp.slice(idx + "/node_modules/".length).split("/");
  if (rest[0] === "typescript" || rest[0] === "@types") return rest[0] === "@types" ? `@types/${rest[1] ?? ""}` : undefined;
  if (rest[0]?.startsWith("@")) return `${rest[0]}/${rest[1] ?? ""}`;
  return rest[0];
}

/** Package declaring a type (`Stripe` from `node_modules/stripe/...`), when its declarations live in node_modules. */
export function packageOfType(t: Type): string | undefined {
  const sym = t.getSymbol() ?? t.getAliasSymbol();
  for (const d of sym?.getDeclarations() ?? []) {
    const pkg = packageFromFilePath(d.getSourceFile().getFilePath());
    if (pkg) return pkg;
  }
  return undefined;
}

function isProjectDecl(decl: Node): boolean {
  const sf = decl.getSourceFile();
  return !sf.isFromExternalLibrary() && !sf.isDeclarationFile() && !sf.getFilePath().includes("/node_modules/");
}

/**
 * Module specifier text; undefined when it is not a string literal. `import { x } from y` is a grammar error that
 * ts-morph's `getModuleSpecifierValue()` turns into an exception, which used to stop the whole scan.
 */
export function specifierOf(decl: ImportDeclaration | ExportDeclaration | undefined): string | undefined {
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
    spec = specifierOf(decl.getFirstAncestor((a) => Node.isImportDeclaration(a)));
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
  const pkg = packageFromSpecifier(spec);
  const reexported = pkg ? undefined : reexportedPackage(sym);
  if (reexported) return reexported;
  if (target && isProjectDecl(target)) return { kind: "local", decl: target };
  if (pkg) return { kind: "package", package: pkg, importedName: importedName ?? "default" };
  if (target) {
    const p = packageFromFilePath(target.getSourceFile().getFilePath());
    if (p) return { kind: "package", package: p, importedName: importedName ?? "default" };
  }
  return { kind: "unknown" };
}

/** Re-exports followed per name, across files (an import cycle ends there). */
const MAX_REEXPORTS = 4;
let following = 0;

/** Runs `f` one re-export deeper; undefined past `MAX_REEXPORTS`. */
function deeper<T>(f: () => T | undefined): T | undefined {
  if (following >= MAX_REEXPORTS) return undefined;
  following++;
  try {
    return f();
  } finally {
    following--;
  }
}

/**
 * A package a project module hands on under its own name: `export { Sentry }` after `import * as Sentry from
 * "@sentry/react"`, `module.exports = Sentry` after `const Sentry = require("@sentry/node")`. Followed alias by alias,
 * since the package's own types (not installed) end the checker's full resolution.
 */
function reexportedPackage(sym: MorphSymbol): IdentOrigin | undefined {
  return deeper(() => {
    const next = sym.getImmediatelyAliasedSymbol();
    for (const d of next?.getDeclarations() ?? []) {
      if (!isProjectDecl(d)) continue;
      const imported = Node.isImportSpecifier(d) || Node.isImportClause(d) || Node.isNamespaceImport(d) || Node.isImportEqualsDeclaration(d) ? fromImport(next!, d) : fromRequire(next!, d);
      if (imported?.kind === "package") return imported;
      // `export { x }`, `export default x`: one more alias to follow
      if (next!.isAlias()) return reexportedPackage(next!);
    }
    return undefined;
  });
}

/**
 * `const Sentry = require("./sentry")` where that file ends `module.exports = Sentry` after `const Sentry =
 * require("@sentry/node")`: the package, read from the required file (the checker's alias stops at the uninstalled one).
 */
function moduleExportsPackage(spec: Node, decl: Node): IdentOrigin | undefined {
  const file = spec.getSymbol()?.getDeclarations()[0];
  if (!Node.isVariableDeclaration(decl) || !file || !Node.isSourceFile(file) || !isProjectDecl(file)) return undefined;
  return deeper(() => {
    for (const st of file.getStatements()) {
      const e = Node.isExpressionStatement(st) ? st.getExpression() : undefined;
      if (!e || !Node.isBinaryExpression(e) || e.getOperatorToken().getKind() !== ts.SyntaxKind.EqualsToken || e.getLeft().getText() !== "module.exports") continue;
      const value = e.getRight();
      const sym = Node.isIdentifier(value) ? value.getSymbol() : undefined;
      const origin = sym?.getDeclarations()[0];
      const found = sym && origin ? fromRequire(sym, origin) : undefined;
      if (found?.kind === "package") return found;
    }
    return undefined;
  });
}

function fromRequire(sym: MorphSymbol, decl: Node): IdentOrigin | undefined {
  if (!Node.isVariableDeclaration(decl) && !Node.isBindingElement(decl)) return undefined;
  const varDecl = Node.isVariableDeclaration(decl) ? decl : decl.getFirstAncestor((a) => Node.isVariableDeclaration(a));
  const given = varDecl?.getInitializer();
  // `const { OpenAI } = await import("openai")`: a module loaded on demand is the package as `require` gives it
  const init = given && Node.isAwaitExpression(given) ? given.getExpression() : given;
  const loader = init && Node.isCallExpression(init) ? init.getExpression() : undefined;
  const dynamic = loader?.getKind() === ts.SyntaxKind.ImportKeyword;
  if (!loader || (loader.getText() !== "require" && !dynamic)) return undefined;
  const arg = (init as CallExpression).getArguments()[0];
  if (!arg || !Node.isStringLiteral(arg)) return undefined;
  const pkg = packageFromSpecifier(arg.getLiteralValue());
  if (!pkg) {
    const reexported = sym.isAlias() ? (reexportedPackage(sym) ?? moduleExportsPackage(arg, decl)) : undefined;
    if (reexported) return reexported;
    // `const { github } = require("./client")`: the checker links the name to its definition in the project
    const target = sym.isAlias() ? sym.getAliasedSymbol()?.getDeclarations()[0] : undefined;
    return target && isProjectDecl(target) ? { kind: "local", decl: target } : undefined;
  }
  const importedName = Node.isBindingElement(decl) ? (decl.getPropertyNameNode()?.getText() ?? decl.getName()) : dynamic ? "*" : "default";
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
    const req = fromRequire(sym, decl);
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
