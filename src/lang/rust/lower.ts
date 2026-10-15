import type { FunctionDef, ModuleModel } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { lowerExpr, newFunction, setStatementHooks } from "./lower-expr.js";
import { bindPattern, endOf, lowerBlock, lowerClosure, lowerParams } from "./lower-stmt.js";
import { EXTRAS, rustModulePath, type RustExtras, type RustFile, type RustState } from "./names.js";
import { lowerUse, segmentsOf } from "./paths.js";
import { fileParser } from "./reparse.js";
import { classFor, lowerStruct } from "./structs-lower.js";
import { lowerType } from "./types.js";

/** `#[cfg(test)]`, `#[test]`, `#[tokio::test]`: test code, out of scope like the files of `tests/`. */
const isTest = (attrs: SyntaxNode[]): boolean => attrs.some((a) => /^#\[\s*(?:cfg\s*\(\s*test\s*\)|(?:[\w:]+::)?test\b)/.test(a.text));

/** A function body in its own state: its parameters and locals. */
export function lowerFunctionBody(fn: FunctionDef, n: SyntaxNode, st: RustState): void {
  const inner: RustState = { ...st, fn, locals: new Set(), urls: new Set() };
  fn.params = lowerParams(field(n, "parameters"), inner);
  const body = field(n, "body");
  if (!body) return;
  const value = lowerBlock(body, inner);
  if (value.k !== "unknown") fn.returns.push(value);
}

function lowerFunction(n: SyntaxNode, st: RustState): void {
  const name = field(n, "name")?.text ?? "anonymous";
  const top = st.fn === st.mod.top;
  // a function of an inline module is an associated function of its class (`inner::f()`), and a name in the file
  const fn = newFunction(name, st.mod, n, !top ? { parent: st.fn } : st.inline ? { cls: st.inline, isStatic: true } : {});
  st.mod.allFunctions.push(fn);
  if (top && st.inline && !st.inline.methods.has(name)) st.inline.methods.set(name, fn);
  if (top && !st.mod.functions.has(name)) st.mod.functions.set(name, fn);
  lowerFunctionBody(fn, n, st);
}

/**
 * `mod inner { ... }`: a class of the file, whose functions and constants are its members, so `inner::X` reads in the
 * file and `crate::m::inner::X` from any other (the index finds classes by qualified name). Its items are also names
 * of the file.
 */
function lowerInlineModule(c: SyntaxNode, st: RustState): void {
  const name = field(c, "name")?.text;
  const body = field(c, "body");
  if (!name || !body) return;
  const cls = st.inline ?? classFor(name, st);
  st.extras.declared.add(cls);
  lowerItems(body, { ...st, inline: cls });
}

/** `impl Client { ... }`, `impl Trait for Client`: methods and associated constants of the type; `self` is `this`. */
function lowerImpl(n: SyntaxNode, st: RustState): void {
  const typeNode = field(n, "type");
  const name = segmentsOf(typeNode)?.at(-1);
  const type = lowerType(typeNode, st);
  if (!name || !type) return;
  const cls = classFor(name, st);
  if (type.k !== "name") st.extras.impls.push({ cls, type });
  const inner: RustState = { ...st, selfType: type };
  let attrs: SyntaxNode[] = [];
  for (const c of named(field(n, "body") ?? n)) {
    const test = isTest(attrs);
    attrs = c.type === "attribute_item" ? [...attrs, c] : [];
    if (test) continue;
    if (c.type === "function_item") {
      const fn = newFunction(field(c, "name")?.text ?? "anonymous", st.mod, c, { cls, isStatic: !named(field(c, "parameters") ?? c).some((p) => p.type === "self_parameter") });
      if (!cls.methods.has(fn.name)) cls.methods.set(fn.name, fn);
      st.mod.allFunctions.push(fn);
      lowerFunctionBody(fn, c, inner);
    } else if (c.type === "const_item") {
      const value = field(c, "value");
      if (value) cls.fields.set(field(c, "name")!.text, [{ value: lowerExpr(value, { ...inner, fn: st.mod.top }), fn: st.mod.top }]);
    }
  }
}

/** `const X: &str = ...;` / `static X: ... = ...;` at module level (or in a function). */
function lowerConst(n: SyntaxNode, st: RustState): void {
  const name = field(n, "name")?.text;
  const value = field(n, "value");
  if (!name || !value) return;
  const type = lowerType(field(n, "type"), st);
  const lowered = lowerExpr(value, st);
  st.fn.assigns.push({ target: name, value: lowered, offset: endOf(n), ...(type ? { type } : {}) });
  if (st.inline && st.fn === st.mod.top) st.inline.fields.set(name, [{ value: lowered, fn: st.fn }]);
}

/** Items of a module, a function body or an inline module; `#[cfg(test)]` and `#[test]` items are skipped. */
export function lowerItems(container: SyntaxNode, st: RustState): void {
  let attrs: SyntaxNode[] = [];
  for (const c of named(container)) {
    if (c.type === "attribute_item") {
      attrs.push(c);
      continue;
    }
    const own = attrs;
    attrs = [];
    if (!isTest(own)) lowerItem(c, own, st);
  }
}

/** One item; false when the node is not an item. */
export function lowerItem(c: SyntaxNode, attrs: SyntaxNode[], st: RustState): boolean {
  switch (c.type) {
    case "use_declaration":
      if (st.fn !== st.mod.top) lowerUse(field(c, "argument"), [], st);
      return true;
    case "function_item":
      lowerFunction(c, st);
      return true;
    case "impl_item":
      lowerImpl(c, st);
      return true;
    case "struct_item":
      lowerStruct(c, attrs, st);
      return true;
    case "const_item":
    case "static_item":
      lowerConst(c, st);
      return true;
    case "mod_item":
      lowerInlineModule(c, st);
      return true;
    case "macro_invocation":
      lowerExpr(c, st);
      return true;
    case "enum_item":
    case "trait_item":
    case "type_item":
    case "union_item":
    case "macro_definition":
    case "extern_crate_declaration":
    case "foreign_mod_item":
    case "function_signature_item":
    case "inner_attribute_item":
    case "line_comment":
    case "block_comment":
    case "empty_statement":
      return true;
    default:
      return false;
  }
}

const NAMED_ITEMS = new Set(["struct_item", "enum_item", "function_item", "const_item", "static_item", "trait_item", "type_item", "union_item"]);

/** Before anything is lowered: the file's child modules, items and `use` aliases, which paths anywhere in it name. */
function prepass(container: SyntaxNode, st: RustState, inline: boolean): void {
  let attrs: SyntaxNode[] = [];
  for (const c of named(container)) {
    if (c.type === "attribute_item") {
      attrs.push(c);
      continue;
    }
    const test = isTest(attrs);
    attrs = [];
    const name = field(c, "name")?.text;
    const body = c.type === "mod_item" ? field(c, "body") : undefined;
    // `#[cfg(test)] mod tests;`: the file `tests.rs` is test code (`linkRust` leaves its calls out)
    if (c.type === "mod_item" && name && test && !body && !inline) st.extras.testMods.add(name);
    if (c.type === "mod_item" && name && !test) {
      if (!inline) (body ? st.file.items : st.file.mods).add(name);
      if (body) prepass(body, st, true);
    } else if (NAMED_ITEMS.has(c.type) && name && !inline) st.file.items.add(name);
    else if (c.type === "extern_crate_declaration" && field(c, "alias")) st.file.uses.set(field(c, "alias")!.text, [field(c, "name")!.text]);
  }
  for (const c of named(container)) if (c.type === "use_declaration") lowerUse(field(c, "argument"), [], st);
}

/** A Rust file as the engine's module model; its name is its module path (`<crate>.llm.client`). */
export function lowerRust(root: SyntaxNode, file: string, rootDir: string): ModuleModel {
  const { module, root: crateRoot } = rustModulePath(file, rootDir);
  const mod: ModuleModel = { file, name: module.join("."), imports: new Map(), importPaths: [], top: undefined as unknown as FunctionDef, functions: new Map(), classes: new Map(), allFunctions: [] };
  mod.top = newFunction("<file>", mod, root);
  mod.allFunctions.push(mod.top);
  const extras: RustExtras = { literals: [], declared: new Set(), impls: [], testMods: new Set() };
  EXTRAS.set(mod, extras);
  const rustFile: RustFile = { module, root: crateRoot, uses: new Map(), mods: new Set(), items: new Set(), parserFor: () => undefined };
  const getParser = fileParser(root);
  rustFile.parserFor = () => (rustFile.parser ??= getParser());
  const st: RustState = { mod, fn: mod.top, file: rustFile, extras, locals: new Set(), urls: new Set() };
  try {
    prepass(root, st, false);
    lowerItems(root, st);
  } finally {
    rustFile.parser?.delete();
  }
  return mod;
}

setStatementHooks({ block: lowerBlock, closure: lowerClosure, bind: bindPattern, item: (n, st) => void lowerItem(n, [], st) });

