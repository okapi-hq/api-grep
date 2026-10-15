import { markBranches, type BranchSyntax } from "../branches.js";
import type { FunctionDef, ModuleModel, Param } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { lowerType } from "./composite.js";
import { lowerExpr, newFunction, setClosureHook } from "./lower-expr.js";
import { EXTRAS, goModuleName, importSegments, packageName, type GoExtras, type GoState } from "./names.js";
import { lowerAssignment, lowerShortVar, lowerSpec } from "./lower-assign.js";
import { classFor, lowerStruct } from "./structs-lower.js";

export const GO_BRANCHES: BranchSyntax = {
  ifStatement: "if_statement",
  then: "consequence",
  // an `else` is a block; `else if` is an if statement, read as one more branch
  elseClause: "block",
  loops: new Set(["for_statement"]),
  clauses: new Set(["expression_case", "default_case", "type_case", "communication_case"]),
};

/** Parameters, by position; `a, b string` declares two, `opts ...Option` collects the rest. */
function lowerParams(n: SyntaxNode | undefined, st: GoState): Param[] {
  const params: Param[] = [];
  for (const decl of n ? named(n) : []) {
    if (decl.type !== "parameter_declaration" && decl.type !== "variadic_parameter_declaration") continue;
    const type = lowerType(field(decl, "type"), st);
    const kind = decl.type === "variadic_parameter_declaration" ? "varargs" : "normal";
    const names = decl.childrenForFieldName("name").filter((c): c is SyntaxNode => !!c);
    if (names.length === 0) params.push({ name: `_${params.length}`, index: params.length, kind, ...(type ? { type } : {}) });
    for (const name of names) {
      params.push({ name: name.text, index: params.length, kind, ...(type ? { type } : {}) });
      st.locals.add(name.text);
    }
  }
  return params;
}

/** A function body in its own state: its parameters and locals shadow the file's import aliases. */
function lowerBody(fn: FunctionDef, n: SyntaxNode, st: GoState, extra: Partial<GoState> = {}): void {
  const inner: GoState = { ...st, fn, locals: new Set(st.fn === st.mod.top ? [] : st.locals), ...extra };
  fn.params = lowerParams(field(n, "parameters"), inner);
  const body = field(n, "body");
  if (body) lowerNode(body, inner);
}

function lowerFunction(n: SyntaxNode, st: GoState): void {
  const fn = newFunction(field(n, "name")?.text ?? "anonymous", st.mod, n);
  st.mod.allFunctions.push(fn);
  st.mod.functions.set(fn.name, fn);
  lowerBody(fn, n, st);
}

/** `func (c *Client) Send(...)`: a method of `Client`, its receiver read as `this`. */
function lowerMethod(n: SyntaxNode, st: GoState): void {
  const recv = field(n, "receiver");
  const decl = recv ? named(recv).find((c) => c.type === "parameter_declaration") : undefined;
  const type = lowerType(decl ? field(decl, "type") : undefined, st);
  if (type?.k !== "name") return;
  const cls = classFor(type.name, st);
  const fn = newFunction(field(n, "name")?.text ?? "anonymous", st.mod, n, { cls });
  cls.methods.set(fn.name, fn);
  st.mod.allFunctions.push(fn);
  const receiver = decl ? field(decl, "name")?.text : undefined;
  lowerBody(fn, n, st, { receiver });
}

/** `func(...) { ... }`: a closure that sees every name of the function around it. */
function lowerClosure(n: SyntaxNode, st: GoState): FunctionDef {
  const fn = newFunction("closure", st.mod, n, { cls: st.fn.cls, parent: st.fn, inherits: ["*"] });
  st.mod.allFunctions.push(fn);
  lowerBody(fn, n, st, { locals: new Set(st.locals) });
  return fn;
}

setClosureHook(lowerClosure);

function lowerImport(spec: SyntaxNode, st: GoState): void {
  const pathNode = field(spec, "path");
  const importPath = pathNode ? lowerExpr(pathNode, st) : undefined;
  if (importPath?.k !== "str" || !importPath.v) return;
  const segments = importSegments(importPath.v);
  st.mod.importPaths.push(segments);
  const name = field(spec, "name");
  if (name?.type === "blank_identifier") return;
  if (name?.type === "dot") {
    (st.mod.wildcards ??= []).push(segments);
    return;
  }
  const alias = name?.text ?? packageName(importPath.v);
  st.mod.imports.set(alias, { path: segments });
  st.extras.imports.set(alias, importPath.v);
}

/** A zero value written out: `""`, `0`, `nil`, `false`. */
const isZero = (n: SyntaxNode): boolean => n.type === "nil" || n.type === "false" || /^(?:""|``|0|0\.0*)$/.test(n.text);

/**
 * `return client, nil`: the value, not the error. `return "", err` returns an error with a zero value standing for
 * nothing: not a value the function gives.
 */
function lowerReturn(n: SyntaxNode, st: GoState): void {
  const list = named(n)[0];
  const values = list?.type === "expression_list" ? named(list) : list ? [list] : [];
  const failed = values.length > 1 && values.at(-1)!.type !== "nil" && isZero(values[0]!);
  values.forEach((v, i) => {
    const e = lowerExpr(v, st);
    if (i === 0 && !failed) st.fn.returns.push(e);
  });
}

function lowerDeclaration(c: SyntaxNode, st: GoState): boolean {
  switch (c.type) {
    case "import_declaration":
      for (const spec of named(c).flatMap((x) => (x.type === "import_spec_list" ? named(x) : [x])).filter((x) => x.type === "import_spec")) lowerImport(spec, st);
      return true;
    case "function_declaration":
      lowerFunction(c, st);
      return true;
    case "method_declaration":
      lowerMethod(c, st);
      return true;
    case "type_declaration":
      for (const spec of named(c).filter((x) => x.type === "type_spec")) lowerStruct(spec, st);
      return true;
    case "var_declaration":
    case "const_declaration":
      for (const spec of named(c).flatMap((x) => (x.type.endsWith("_spec_list") ? named(x) : [x])).filter((x) => x.type.endsWith("_spec"))) lowerSpec(spec, st);
      return true;
    default:
      return false;
  }
}

function lowerStatement(c: SyntaxNode, st: GoState): boolean {
  if (lowerDeclaration(c, st)) return true;
  switch (c.type) {
    case "short_var_declaration":
      lowerShortVar(c, st);
      return true;
    case "assignment_statement":
      lowerAssignment(c, st);
      return true;
    case "return_statement":
      lowerReturn(c, st);
      return true;
    case "package_clause":
    case "comment":
      return true;
    default:
      return false;
  }
}

const CONTAINERS = new Set(["source_file", "block", "statement_list", "for_clause", "range_clause", "labeled_statement", "go_statement", "defer_statement", "expression_statement", "expression_list"]);

/** A statement, a block, or an expression; anything unknown still has its calls recorded. */
export function lowerNode(n: SyntaxNode, st: GoState): void {
  if (lowerStatement(n, st)) return;
  if (CONTAINERS.has(n.type) || n.type.endsWith("_statement") || n.type.endsWith("_case")) {
    markBranches(n, st.fn, GO_BRANCHES);
    for (const x of named(n)) lowerNode(x, st);
    return;
  }
  lowerExpr(n, st);
}

/** A Go file as the engine's module model; its name is its package's import path. */
export function lowerGo(root: SyntaxNode, file: string, rootDir: string): ModuleModel {
  const mod: ModuleModel = { file, name: goModuleName(file, rootDir), imports: new Map(), importPaths: [], top: undefined as unknown as FunctionDef, functions: new Map(), classes: new Map(), allFunctions: [] };
  mod.top = newFunction("<file>", mod, root);
  mod.allFunctions.push(mod.top);
  const extras: GoExtras = { literals: [], declared: new Set(), order: new Map(), imports: new Map() };
  EXTRAS.set(mod, extras);
  lowerNode(root, { mod, fn: mod.top, extras, locals: new Set() });
  return mod;
}

