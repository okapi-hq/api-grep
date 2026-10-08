import path from "node:path";
import type { ClassDef, Expr, FunctionDef, ModuleModel } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { lowerExpr, newFunction, type PyState } from "./lower-expr.js";
import { decoratorNames, lowerParams, lowerType } from "./lower-types.js";

interface ModState extends PyState {
  isPackage: boolean;
}

/** `app/services/billing.py` -> `app.services.billing`; a package's `__init__.py` is the package. */
export function moduleName(file: string, rootDir: string): { name: string; isPackage: boolean } {
  const rel = path.relative(rootDir, file).split(path.sep).join("/").replace(/\.pyi?$/, "");
  const isPackage = rel === "__init__" || rel.endsWith("/__init__");
  const name = (isPackage ? rel.replace(/\/?__init__$/, "") : rel).split("/").filter(Boolean).join(".");
  return { name, isPackage };
}

function lowerFunction(n: SyntaxNode, st: ModState, cls: ClassDef | undefined, decorators: string[]): FunctionDef {
  const name = field(n, "name")?.text ?? "anonymous";
  const isStatic = decorators.includes("staticmethod");
  const fn = newFunction(name, st.mod, n, { cls: cls ?? st.fn.cls, isStatic });
  if (st.fn !== st.mod.top && !cls) {
    fn.parent = st.fn;
    fn.inherits = ["*"];
  }
  st.mod.allFunctions.push(fn);
  const inner: ModState = { ...st, fn };
  const { params, receiver } = lowerParams(field(n, "parameters"), inner, !!cls && !isStatic);
  fn.params = params;
  if (cls) inner.receiver = isStatic ? undefined : receiver;
  const body = field(n, "body");
  if (body) lowerBlock(body, inner);
  return fn;
}

/** A `def` statement: a module function, or a name bound in the enclosing function. */
function lowerDef(n: SyntaxNode, st: ModState, decorators: string[]): void {
  const fn = lowerFunction(n, st, undefined, decorators);
  if (st.fn === st.mod.top) st.mod.functions.set(fn.name, fn);
  else st.fn.assigns.push({ target: fn.name, value: { k: "fnref", fn }, offset: n.startIndex });
}

function addField(cls: ClassDef, name: string, value: Expr, fn: FunctionDef): void {
  cls.fields.set(name, [...(cls.fields.get(name) ?? []), { value, fn }]);
}

function classAttribute(cls: ClassDef, name: string, value: Expr | undefined, annotation: { type?: Expr; optional: boolean }, st: PyState): void {
  if (value) addField(cls, name, value, st.fn);
  if (!annotation.type) return;
  cls.fieldTypes.set(name, annotation.type);
  cls.annotations.push({ name, type: annotation.type, optional: annotation.optional || !!value });
}

/** `x = v`, `self.x = v`, `a, b = 1, 2`, `a = b = v`, `x += v`: assignments of the current function, and class fields. */
function lowerAssignment(n: SyntaxNode, st: PyState, cls?: ClassDef): void {
  const left = field(n, "left");
  const rightNode = field(n, "right");
  if (rightNode?.type === "assignment") lowerAssignment(rightNode, st, cls);
  const valueNode = rightNode?.type === "assignment" ? field(rightNode, "right") : rightNode;
  const value: Expr | undefined = valueNode ? lowerExpr(valueNode, st) : undefined;
  const augmented = n.type === "augmented_assignment";
  if (!left || (augmented && field(n, "operator")?.text !== "+=")) return;
  if (left.type === "identifier") {
    const annotation = lowerType(field(n, "type"), st);
    if (cls) classAttribute(cls, left.text, value, annotation, st);
    if (value) st.fn.assigns.push({ target: left.text, value, offset: n.endIndex, ...(augmented ? { augmented } : {}), ...(annotation.type ? { type: annotation.type } : {}) });
    return;
  }
  if (left.type === "attribute" && st.receiver && field(left, "object")?.text === st.receiver && st.fn.cls && value) {
    const attr = field(left, "attribute")!.text;
    addField(st.fn.cls, attr, value, st.fn);
    const t = lowerType(field(n, "type"), st).type;
    if (t) st.fn.cls.fieldTypes.set(attr, t);
    return;
  }
  if ((left.type === "pattern_list" || left.type === "tuple_pattern") && value?.k === "list") {
    named(left).forEach((t, i) => {
      if (t.type === "identifier" && value.items[i]) st.fn.assigns.push({ target: t.text, value: value.items[i]!, offset: n.endIndex });
    });
  }
}

function lowerClass(n: SyntaxNode, st: ModState): void {
  const name = field(n, "name")!.text;
  const cls: ClassDef = { name, qname: st.mod.name ? `${st.mod.name}.${name}` : name, bases: [], methods: new Map(), fields: new Map(), fieldTypes: new Map(), annotations: [], module: st.mod };
  const supers = field(n, "superclasses");
  cls.bases = supers ? named(supers).filter((c) => c.type !== "keyword_argument" && c.type !== "comment").map((c) => lowerExpr(c, st)) : [];
  if (st.fn === st.mod.top) st.mod.classes.set(name, cls);
  else st.fn.assigns.push({ target: name, value: { k: "unknown", text: name }, offset: n.startIndex });
  const body = field(n, "body");
  for (const c of body ? named(body) : []) {
    const def = c.type === "decorated_definition" ? field(c, "definition") : c;
    if (def?.type === "function_definition") {
      const fn = lowerFunction(def, st, cls, c.type === "decorated_definition" ? decoratorNames(c) : []);
      cls.methods.set(fn.name, fn);
    } else if (c.type === "expression_statement") {
      for (const e of named(c)) if (e.type === "assignment") lowerAssignment(e, st, cls);
    }
  }
}

/** Absolute dotted path of `from <dots><name> import ...` in this module. */
function fromPath(moduleNode: SyntaxNode | undefined, st: ModState): string[] {
  if (!moduleNode) return [];
  if (moduleNode.type === "dotted_name") return named(moduleNode).map((c) => c.text);
  const dots = (named(moduleNode).find((c) => c.type === "import_prefix")?.text ?? ".").length;
  const pkg = st.mod.name ? st.mod.name.split(".") : [];
  const base = (st.isPackage ? pkg : pkg.slice(0, -1)).slice(0, Math.max(0, (st.isPackage ? pkg.length : pkg.length - 1) - (dots - 1)));
  const rest = named(moduleNode).find((c) => c.type === "dotted_name");
  return [...base, ...(rest ? named(rest).map((c) => c.text) : [])];
}

function lowerImport(n: SyntaxNode, st: ModState): void {
  const isFrom = n.type === "import_from_statement";
  const base = isFrom ? fromPath(field(n, "module_name"), st) : [];
  if (isFrom && named(n).some((c) => c.type === "wildcard_import")) st.mod.importPaths.push(base);
  for (const c of n.childrenForFieldName("name").filter((x): x is SyntaxNode => !!x)) {
    const nameNode = c.type === "aliased_import" ? field(c, "name")! : c;
    const segs = named(nameNode).map((x) => x.text);
    const full = [...base, ...segs];
    const alias = c.type === "aliased_import" ? field(c, "alias")?.text : undefined;
    st.mod.importPaths.push(full);
    if (alias) st.mod.imports.set(alias, { path: full });
    else if (isFrom) st.mod.imports.set(segs[segs.length - 1]!, { path: full });
    else st.mod.imports.set(segs[0]!, { path: [segs[0]!] });
  }
}

/** `with httpx.Client() as client:` binds `client` to the client. */
function lowerWith(n: SyntaxNode, st: ModState): void {
  for (const clause of named(n).filter((c) => c.type === "with_clause")) {
    for (const item of named(clause)) {
      const value = field(item, "value");
      if (value?.type === "as_pattern") {
        const target = field(value, "alias");
        const v = lowerExpr(named(value)[0]!, st);
        const name = target ? named(target)[0] : undefined;
        if (name?.type === "identifier") st.fn.assigns.push({ target: name.text, value: v, offset: item.endIndex });
      } else if (value) lowerExpr(value, st);
    }
  }
  const body = field(n, "body");
  if (body) lowerBlock(body, st);
}

const SKIP = new Set(["pass_statement", "break_statement", "continue_statement", "global_statement", "nonlocal_statement", "comment", "future_import_statement"]);

function lowerStatement(c: SyntaxNode, st: ModState): void {
  if (SKIP.has(c.type)) return;
  if (c.type === "expression_statement") {
    for (const e of named(c)) if (e.type === "assignment" || e.type === "augmented_assignment") lowerAssignment(e, st);
    else lowerExpr(e, st);
  } else if (c.type === "function_definition") lowerDef(c, st, []);
  else if (c.type === "decorated_definition") {
    const def = field(c, "definition");
    if (def?.type === "function_definition") lowerDef(def, st, decoratorNames(c));
    else if (def?.type === "class_definition") lowerClass(def, st);
  } else if (c.type === "class_definition") lowerClass(c, st);
  else if (c.type === "import_statement" || c.type === "import_from_statement") lowerImport(c, st);
  else if (c.type === "return_statement") {
    const e = named(c)[0];
    if (e) st.fn.returns.push(lowerExpr(e, st));
  } else if (c.type === "with_statement") lowerWith(c, st);
  else for (const x of named(c)) lowerNode(x, st);
}

/** A statement, a block or clause (`else:`, `except:`), or an expression (a condition, a loop's iterable). */
function lowerNode(c: SyntaxNode, st: ModState): void {
  if (c.type.endsWith("_statement") || c.type.endsWith("_definition") || c.type === "expression_statement") lowerStatement(c, st);
  else if (c.type === "block" || c.type.endsWith("_clause") || c.type === "module") lowerBlock(c, st);
  else if (!SKIP.has(c.type)) lowerExpr(c, st);
}

function lowerBlock(n: SyntaxNode, st: ModState): void {
  for (const c of named(n)) lowerNode(c, st);
}

/** A Python file as the engine's module model. */
export function lowerPython(root: SyntaxNode, file: string, rootDir: string): ModuleModel {
  const { name, isPackage } = moduleName(file, rootDir);
  const mod: ModuleModel = { file, name, imports: new Map(), importPaths: [], top: undefined as unknown as FunctionDef, functions: new Map(), classes: new Map(), allFunctions: [] };
  mod.top = newFunction("<module>", mod, root);
  mod.allFunctions.push(mod.top);
  lowerBlock(root, { mod, fn: mod.top, isPackage });
  return mod;
}
