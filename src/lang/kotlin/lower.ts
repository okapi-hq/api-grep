import type { FunctionDef, ModuleModel } from "../ir/model.js";
import { named, type SyntaxNode } from "../tree-sitter.js";
import "./lower-class.js";
import { lowerFunction, lowerStatement } from "./lower-stmt.js";
import { hook, newFunction, type KtState } from "./state.js";

const identifiers = (n: SyntaxNode | undefined): string[] => (n ? named(n).filter((c) => c.type === "identifier") : []).map((c) => c.text);

/** `import a.b.C`, `import a.b.C as D`, `import a.b.*` (a package imported whole). */
function lowerImport(n: SyntaxNode, mod: ModuleModel): void {
  const q = named(n).find((c) => c.type === "qualified_identifier");
  const path = identifiers(q);
  if (path.length === 0) return;
  mod.importPaths.push(path);
  if (n.children.some((c) => c?.type === "*")) {
    mod.wildcards!.push(path);
    return;
  }
  const alias = named(n).find((c) => c.type === "identifier")?.text;
  mod.imports.set(alias ?? path[path.length - 1]!, { path });
}

function lowerTop(c: SyntaxNode, st: KtState): void {
  switch (c.type) {
    case "package_header":
    case "file_annotation":
    case "shebang":
    case "line_comment":
    case "block_comment":
      return;
    case "import":
      return lowerImport(c, st.mod);
    case "function_declaration": {
      const fn = lowerFunction(c, st, false);
      // overloads: the name resolves to the first one, and every one is scanned
      if (!st.mod.functions.has(fn.name)) st.mod.functions.set(fn.name, fn);
      return;
    }
    case "class_declaration":
    case "object_declaration":
      return hook("classDecl")(c, st, true);
    default:
      lowerStatement(c, st);
  }
}

/** A Kotlin file (or script) as the engine's module model; its name is its package. */
export function lowerKotlin(root: SyntaxNode, file: string, rootDir: string): ModuleModel {
  const pkg = identifiers(named(named(root).find((c) => c.type === "package_header") ?? root).find((c) => c.type === "qualified_identifier"));
  const mod: ModuleModel = {
    file,
    name: pkg.join("."),
    imports: new Map(),
    importPaths: [],
    wildcards: [],
    top: undefined as unknown as FunctionDef,
    functions: new Map(),
    classes: new Map(),
    allFunctions: [],
  };
  mod.top = newFunction("<file>", mod, root);
  mod.allFunctions.push(mod.top);
  const st: KtState = { mod, fn: mod.top, scope: { names: new Set() }, rootDir };
  for (const c of named(root)) lowerTop(c, st);
  return mod;
}
