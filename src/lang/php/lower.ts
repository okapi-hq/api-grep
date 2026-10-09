import type { ClassDef, Expr, FunctionDef, ModuleModel, Param } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { lowerExpr, newFunction, setStatementHooks } from "./lower-expr.js";
import { classPath, lowerUse, newNames, posOf, type PhpState } from "./names.js";

/** A declared type as a class reference: `?Client`, `Client|null` and `StripeClient` give the class; scalars their name. */
function lowerType(n: SyntaxNode | undefined, st: PhpState): Expr | undefined {
  if (!n) return undefined;
  if (n.type === "primitive_type") return { k: "name", name: n.text, pos: posOf(n) };
  if (n.type === "named_type") {
    const nameNode = named(n)[0];
    return nameNode ? { k: "qname", path: classPath(nameNode.text, st), pos: posOf(nameNode) } : undefined;
  }
  const inner = named(n).find((c) => c.type === "named_type") ?? named(n).find((c) => c.type === "primitive_type" && c.text !== "null");
  return inner ? lowerType(inner, st) : undefined;
}

const varName = (n: SyntaxNode | undefined): string | undefined => (n ? `$${n.text.replace(/^\$/, "")}` : undefined);

/** Parameters; a promoted constructor parameter is also a field of the class (`private Client $http`). */
function lowerParams(n: SyntaxNode | undefined, st: PhpState, cls: ClassDef | undefined, fn: FunctionDef): Param[] {
  const params: Param[] = [];
  for (const p of n ? named(n) : []) {
    const name = varName(field(p, "name"));
    if (!name) continue;
    const dflt = field(p, "default_value");
    const type = lowerType(field(p, "type"), st);
    params.push({ name, index: params.length, kind: p.type === "variadic_parameter" ? "varargs" : "normal", ...(dflt ? { default: lowerExpr(dflt, st) } : {}), ...(type ? { type } : {}) });
    if (p.type === "property_promotion_parameter" && cls) {
      const prop = name.slice(1);
      addField(cls, prop, { k: "name", name, pos: posOf(p) }, fn);
      if (type) cls.fieldTypes.set(prop, type);
    }
  }
  return params;
}

function addField(cls: ClassDef, name: string, value: Expr, fn: FunctionDef): void {
  cls.fields.set(name, [...(cls.fields.get(name) ?? []), { value, fn }]);
}

function lowerFunction(n: SyntaxNode, st: PhpState, cls?: ClassDef): FunctionDef {
  const isStatic = named(n).some((c) => c.type === "static_modifier");
  const fn = newFunction(field(n, "name")?.text ?? "anonymous", st.mod, n, { cls, isStatic });
  st.mod.allFunctions.push(fn);
  const inner: PhpState = { ...st, fn };
  fn.params = lowerParams(field(n, "parameters"), inner, cls, fn);
  const body = field(n, "body");
  if (body) lowerNode(body, inner);
  return fn;
}

/** `function ($x) use ($base) {...}` sees `$base`; `fn ($x) => ...` sees every variable of its parent. */
function lowerClosure(n: SyntaxNode, st: PhpState): FunctionDef {
  const fn = newFunction("closure", st.mod, n, { cls: st.fn.cls, parent: st.fn });
  const uses = named(n).find((c) => c.type === "anonymous_function_use_clause");
  fn.inherits = n.type === "arrow_function" ? ["*"] : (uses ? named(uses) : []).map((u) => varName(u)!).filter(Boolean);
  st.mod.allFunctions.push(fn);
  const inner: PhpState = { ...st, fn };
  fn.params = lowerParams(field(n, "parameters"), inner, undefined, fn);
  const body = field(n, "body");
  if (body?.type === "compound_statement") lowerNode(body, inner);
  else if (body) fn.returns.push(lowerExpr(body, inner));
  return fn;
}

/** `$x = v`, `$x .= v`, `$this->x = v`, `self::$x = v`: assignments of the current function, and class fields. */
function lowerAssignment(n: SyntaxNode, st: PhpState): Expr {
  const left = field(n, "left");
  const value = lowerExpr(field(n, "right")!, st);
  const op = field(n, "operator")?.text;
  const augmented = n.type === "augmented_assignment_expression";
  if (!left || (augmented && op !== ".=" && op !== "??=")) return value;
  if (left.type === "variable_name") {
    st.fn.assigns.push({ target: varName(left)!, value, offset: n.endIndex, ...(augmented && op === ".=" ? { augmented: true } : {}) });
  } else if ((left.type === "member_access_expression" && field(left, "object")?.text === "$this") || left.type === "scoped_property_access_expression") {
    const name = field(left, "name")?.text.replace(/^\$/, "");
    if (name && st.fn.cls) addField(st.fn.cls, name, value, st.fn);
  }
  return value;
}

setStatementHooks({ closure: lowerClosure, assignment: lowerAssignment });

function lowerClassMember(c: SyntaxNode, st: PhpState, cls: ClassDef): void {
  if (c.type === "method_declaration") {
    const fn = lowerFunction(c, st, cls);
    cls.methods.set(fn.name, fn);
  } else if (c.type === "const_declaration") {
    for (const el of named(c).filter((x) => x.type === "const_element")) {
      const [nameNode, valueNode] = named(el);
      if (nameNode && valueNode) addField(cls, nameNode.text, lowerExpr(valueNode, st), st.mod.top);
    }
  } else if (c.type === "property_declaration") {
    const type = lowerType(field(c, "type"), st);
    for (const el of named(c).filter((x) => x.type === "property_element")) {
      const name = field(el, "name")?.text.replace(/^\$/, "");
      const dflt = field(el, "default_value");
      if (!name) continue;
      if (dflt && dflt.type !== "null") addField(cls, name, lowerExpr(dflt, st), st.mod.top);
      if (type) cls.fieldTypes.set(name, type);
    }
  } else if (c.type === "use_declaration") {
    for (const t of named(c).filter((x) => x.type === "name" || x.type === "qualified_name")) cls.bases.push({ k: "qname", path: classPath(t.text, st), pos: posOf(t) });
  }
}

function lowerClass(n: SyntaxNode, st: PhpState): void {
  const name = field(n, "name")?.text ?? "anonymous";
  const path = [...st.names.namespace, name];
  const baseNode = named(n).find((c) => c.type === "base_clause");
  const parent = baseNode ? classPath(named(baseNode)[0]!.text, st) : undefined;
  const cls: ClassDef = { name, qname: path.join("."), bases: [], methods: new Map(), fields: new Map(), fieldTypes: new Map(), annotations: [], module: st.mod };
  if (parent) cls.bases.push({ k: "qname", path: parent, pos: posOf(baseNode!) });
  st.mod.classes.set(name, cls);
  const inner: PhpState = { ...st, cls: { path, parent } };
  const body = field(n, "body");
  for (const c of body ? named(body) : []) lowerClassMember(c, inner, cls);
}

/** `namespace A\B;` applies to the rest of the file, `namespace A\B { ... }` to its block. */
function lowerNamespace(n: SyntaxNode, st: PhpState): void {
  const nameNode = field(n, "name");
  const ns = nameNode ? nameNode.text.replace(/^\\/, "").split("\\") : [];
  const body = field(n, "body");
  if (!body) {
    st.names.namespace = ns;
    if (!st.mod.name) st.mod.name = ns.join(".");
    return;
  }
  const inner: PhpState = { ...st, names: { ...newNames(), namespace: ns } };
  if (!st.mod.name) st.mod.name = ns.join(".");
  lowerNode(body, inner);
}

/** `const BASE = '...';` and `define('BASE', '...')` are module constants every file sees. */
function lowerConst(n: SyntaxNode, st: PhpState): void {
  for (const el of named(n).filter((x) => x.type === "const_element")) {
    const [nameNode, valueNode] = named(el);
    if (nameNode && valueNode) st.mod.top.assigns.push({ target: nameNode.text, value: lowerExpr(valueNode, st), offset: el.endIndex });
  }
}

function lowerStatement(c: SyntaxNode, st: PhpState): boolean {
  switch (c.type) {
    case "namespace_definition":
      lowerNamespace(c, st);
      return true;
    case "namespace_use_declaration":
      st.mod.importPaths.push(...lowerUse(c, st));
      return true;
    case "function_definition": {
      const fn = lowerFunction(c, st);
      st.mod.functions.set(fn.name, fn);
      return true;
    }
    case "class_declaration":
    case "trait_declaration":
    case "enum_declaration":
      lowerClass(c, st);
      return true;
    case "const_declaration":
      lowerConst(c, st);
      return true;
    case "return_statement": {
      const e = named(c)[0];
      if (e) st.fn.returns.push(lowerExpr(e, st));
      return true;
    }
    case "interface_declaration":
    case "comment":
    case "text":
    case "php_tag":
    case "text_interpolation":
      return true;
    default:
      return false;
  }
}

/** A statement, a block, or an expression; anything unknown still has its calls recorded. */
function lowerNode(n: SyntaxNode, st: PhpState): void {
  if (lowerStatement(n, st)) return;
  if (n.type === "expression_statement") {
    for (const e of named(n)) lowerTopExpr(e, st);
    return;
  }
  if (n.type.endsWith("_statement") || n.type.endsWith("_clause") || n.type === "program" || n.type === "compound_statement" || n.type.endsWith("_list") || n.type === "colon_block") {
    for (const x of named(n)) lowerNode(x, st);
    return;
  }
  lowerExpr(n, st);
}

/** `define('API', 'https://...')` at statement level is a constant; other expressions are lowered as usual. */
function lowerTopExpr(e: SyntaxNode, st: PhpState): void {
  const fnName = e.type === "function_call_expression" ? field(e, "function")?.text.replace(/^\\/, "").toLowerCase() : undefined;
  const args = fnName === "define" ? named(field(e, "arguments") ?? e).filter((a) => a.type === "argument") : [];
  if (args.length >= 2) {
    const key = lowerExpr(named(args[0]!)[0]!, st);
    if (key.k === "str") {
      st.mod.top.assigns.push({ target: key.v, value: lowerExpr(named(args[1]!).pop()!, st), offset: e.endIndex });
      return;
    }
  }
  lowerExpr(e, st);
}

/** A PHP file as the engine's module model; its name is its (first) namespace. */
export function lowerPhp(root: SyntaxNode, file: string): ModuleModel {
  const mod: ModuleModel = { file, name: "", imports: new Map(), importPaths: [], top: undefined as unknown as FunctionDef, functions: new Map(), classes: new Map(), allFunctions: [] };
  mod.top = newFunction("<file>", mod, root);
  mod.allFunctions.push(mod.top);
  lowerNode(root, { mod, fn: mod.top, names: newNames() });
  return mod;
}
