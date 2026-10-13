import type { FunctionDef, ModuleModel } from "../ir/model.js";
import type { SyntaxNode } from "../tree-sitter.js";
import "./lower-class.js";
import { lowerMethod } from "./lower-fn.js";
import { lowerStatement } from "./lower-stmt.js";
import { hook, named, newFunction, type JState } from "./state.js";
import { typePath } from "./types.js";

/** `import a.b.C;`, `import static a.b.C.NAME;` (a class member), `import a.b.*;` and `import static a.b.C.*;` (whole). */
function lowerImport(n: SyntaxNode, mod: ModuleModel): void {
  const id = named(n).find((c) => c.type === "scoped_identifier" || c.type === "identifier");
  const path = id ? typePath(id) : undefined;
  if (!path || path.length === 0) return;
  mod.importPaths.push(path);
  if (named(n).some((c) => c.type === "asterisk")) mod.wildcards!.push(path);
  else mod.imports.set(path[path.length - 1]!, { path });
}

function lowerTop(c: SyntaxNode, st: JState): void {
  switch (c.type) {
    case "package_declaration":
    case "module_declaration":
      return;
    case "import_declaration":
      return lowerImport(c, st.mod);
    case "method_declaration": {
      // a snippet with a method outside any class (not valid Java, but parsed): a function of the file
      const fn = lowerMethod(c, st, false);
      if (!st.mod.functions.has(fn.name)) st.mod.functions.set(fn.name, fn);
      return;
    }
    default:
      if (c.type.endsWith("_declaration")) return hook("classDecl")(c, st, true);
      lowerStatement(c, st);
  }
}

/** A Java file as the engine's module model; its name is its package, like a Kotlin file's. */
export function lowerJava(root: SyntaxNode, file: string, rootDir: string): ModuleModel {
  const pkgNode = named(root).find((c) => c.type === "package_declaration");
  const pkgId = pkgNode ? named(pkgNode).find((c) => c.type === "scoped_identifier" || c.type === "identifier") : undefined;
  const mod: ModuleModel = {
    file,
    name: (pkgId ? (typePath(pkgId) ?? []) : []).join("."),
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
  const st: JState = { mod, fn: mod.top, scope: { names: new Set() }, rootDir, builders: new Map() };
  for (const c of named(root)) lowerTop(c, st);
  return mod;
}
