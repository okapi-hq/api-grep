import type { FunctionDef, ModuleModel } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { declarators, lowerClass } from "./lower-class.js";
import { isComment, lowerNodes } from "./lower-expr.js";
import { declaredType, inFunction, lowerBody, lowerParams } from "./lower-stmt.js";
import { lowerString } from "./literals.js";
import { dartModulePath, EXTRAS, importTarget, newFunction, type DartExtras, type DartState, type OpenImport } from "./names.js";

/**
 * A Dart file as the engine's module model: its directives (imports with a prefix are names of the file, the others
 * and exports are resolved by `link.ts` once every file is lowered), top-level variables, functions and getters, and
 * classes. The grammar writes a top-level declaration as siblings (`function_signature` then `function_body`, a type
 * then a declaration list), read in order.
 */

/** The text of a directive's URI (`'package:dio/dio.dart'`). */
function uriOf(n: SyntaxNode): string | undefined {
  const lit = n.descendantsOfType("string_literal")[0];
  const v = lit ? lowerString(lit, () => ({ k: "unknown", text: "" })) : undefined;
  return v?.k === "str" ? v.v : undefined;
}

const combinator = (n: SyntaxNode, kind: "show" | "hide"): string[] | undefined => {
  const c = named(n).filter((x) => x.type === "combinator" && x.child(0)?.type === kind);
  return c.length > 0 ? c.flatMap((x) => named(x).map((id) => id.text)) : undefined;
};

/** `import 'uri' as p show a hide b;`, `export 'uri';`, `part 'uri';`, `part of 'uri';`. */
function lowerDirective(n: SyntaxNode, st: DartState, extras: DartExtras): void {
  const spec = n.type === "import_or_export" ? named(n)[0] : n;
  const inner = spec?.type === "library_import" ? named(spec).find((c) => c.type === "import_specification") : spec;
  const uri = inner ? uriOf(inner) : undefined;
  const path = uri !== undefined ? importTarget(uri, st.mod.file, st.rootDir) : undefined;
  if (!inner || !path) return;
  if (n.type === "part_directive") return void extras.parts.push(path);
  if (n.type === "part_of_directive") return void (extras.partOf = path);
  const open: OpenImport = { path, ...(combinator(inner, "show") ? { show: combinator(inner, "show") } : {}), ...(combinator(inner, "hide") ? { hide: combinator(inner, "hide") } : {}) };
  if (spec?.type === "library_export") return void extras.exports.push(open);
  st.mod.importPaths.push(path);
  const as = inner.children.findIndex((c) => c?.type === "as");
  const prefix = as >= 0 ? inner.children.slice(as + 1).find((c) => c?.type === "identifier")?.text : undefined;
  if (prefix) st.mod.imports.set(prefix, { path });
  else extras.open.push(open);
}

/** `final x = v, y;` / `const String base = '...';` at top level: values of the module. */
function lowerTopVars(list: SyntaxNode, typeNodes: SyntaxNode[], st: DartState): void {
  const type = declaredType(typeNodes);
  for (const d of declarators(list)) {
    st.mod.top.assigns.push({ target: d.name.text, value: d.value.length > 0 ? lowerNodes(d.value, st) : { k: "unknown", text: "uninitialized" }, offset: d.name.startIndex, ...(type ? { type } : {}) });
  }
}

/** A top-level function or getter; a getter's value is also a module value (`String get baseUrl => ...`). */
function lowerTopFunction(sig: SyntaxNode, body: SyntaxNode | undefined, st: DartState): void {
  const name = field(sig, "name")?.text;
  if (!name) return;
  const fn: FunctionDef = newFunction(sig.type === "setter_signature" ? `${name}=` : name, st.mod, sig);
  st.mod.allFunctions.push(fn);
  if (sig.type === "function_signature" && !st.mod.functions.has(name)) st.mod.functions.set(name, fn);
  fn.params = lowerParams(named(sig).find((c) => c.type === "formal_parameter_list"), st);
  lowerBody(body, inFunction(st, fn, false));
  if (sig.type === "getter_signature") for (const r of fn.returns) st.mod.top.assigns.push({ target: name, value: { k: "scoped", expr: r, fn }, offset: sig.startIndex });
}

const DIRECTIVES = new Set(["import_or_export", "part_directive", "part_of_directive"]);
const CLASSES = new Set(["class_definition", "mixin_declaration", "enum_declaration", "extension_declaration", "extension_type_declaration"]);
const FUNCTIONS = new Set(["function_signature", "getter_signature", "setter_signature"]);
const LISTS = new Set(["static_final_declaration_list", "initialized_identifier_list"]);

function lowerProgram(root: SyntaxNode, st: DartState, extras: DartExtras): void {
  const kids = root.children.filter((c): c is SyntaxNode => !!c && !isComment(c));
  let typeNodes: SyntaxNode[] = [];
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i]!;
    if (DIRECTIVES.has(c.type)) lowerDirective(c, st, extras);
    else if (CLASSES.has(c.type)) lowerClass(c, st);
    else if (FUNCTIONS.has(c.type)) {
      const body = kids[i + 1]?.type === "function_body" ? kids[++i] : undefined;
      lowerTopFunction(c, body, st);
    } else if (LISTS.has(c.type)) lowerTopVars(c, typeNodes, st);
    // a declaration's type comes before its list; anything else ends it
    typeNodes = c.type === "type_identifier" || c.type === "type_arguments" || c.type === "nullable_type" ? [...typeNodes, c] : [];
  }
}

/** A Dart file as a module named after its package and path (`<package>.services.api`). */
export function lowerDart(root: SyntaxNode, file: string, rootDir: string): ModuleModel {
  const mod: ModuleModel = { file, name: dartModulePath(file, rootDir).join("."), imports: new Map(), importPaths: [], wildcards: [], top: undefined as unknown as FunctionDef, functions: new Map(), classes: new Map(), allFunctions: [] };
  mod.top = newFunction("<file>", mod, root);
  mod.allFunctions.push(mod.top);
  const extras: DartExtras = { open: [], exports: [], parts: [] };
  EXTRAS.set(mod, extras);
  lowerProgram(root, { mod, fn: mod.top, scope: { names: new Set() }, rootDir }, extras);
  return mod;
}
