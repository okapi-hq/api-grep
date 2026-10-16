import { markBranches, type BranchSyntax } from "../branches.js";
import type { Expr, FunctionDef, Param } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { isComment, lowerNodes, lowerOther, lowerRun, runsOf, setExprHooks } from "./lower-expr.js";
import { addField, DEEP_SETS, inBlock, isLocal, newFunction, posOf, type DartState } from "./names.js";

/**
 * Statements: local variables (`final x = v;`, `String x = v;`, `late Dio dio;`), assignments (`x = v`, `this.f = v`
 * and a member's bare name are fields of the class, `obj.f = v` an attribute set on a local, `map['k'] = v` a key
 * added to a map), returns, control flow, local functions; and functions: parameters and bodies.
 */

export const DART_BRANCHES: BranchSyntax = {
  ifStatement: "if_statement",
  then: "consequence",
  // `else { ... }` is the block itself; `else if` an `if_statement`
  elseClause: "block",
  loops: new Set(["for_statement", "while_statement", "do_statement"]),
  clauses: new Set(["switch_statement_case", "switch_statement_default", "catch_clause"]),
};

const TYPE_NODES = new Set(["type_identifier", "void_type", "function_type", "record_type"]);

/** A declared type as an expression: `Dio` -> `Dio`, `http.Response` -> `http.Response`; type arguments are left out. */
export function declaredType(nodes: SyntaxNode[]): Expr | undefined {
  const ids = nodes.filter((c) => c.type === "type_identifier");
  if (ids.length === 0) return undefined;
  let t: Expr = { k: "name", name: ids[0]!.text, pos: posOf(ids[0]!) };
  for (const id of ids.slice(1)) t = { k: "attr", obj: t, name: id.text, pos: posOf(id) };
  return t;
}

/** Binds a local variable to its value (or to its type alone: `late Dio dio;`). */
function bind(name: string, value: Expr | undefined, type: Expr | undefined, offset: number, st: DartState): void {
  st.scope.names.add(name);
  if (!value && !type) return;
  st.fn.assigns.push({ target: name, value: value ?? { k: "unknown", text: "uninitialized" }, offset, ...(type ? { type } : {}) });
}

const children = (n: SyntaxNode, name: string): SyntaxNode[] => n.childrenForFieldName(name).filter((x): x is SyntaxNode => !!x);

/** `final Dio dio = Dio(), other;`: the first declarator has fields, the others are `initialized_identifier`s. */
function lowerVarDef(def: SyntaxNode, st: DartState): void {
  const nameNode = field(def, "name");
  if (!nameNode) return void lowerOther(def, st);
  const type = declaredType(named(def).filter((c) => c.endIndex <= nameNode.startIndex));
  const values = children(def, "value");
  bind(nameNode.text, values.length > 0 ? lowerNodes(values, st) : undefined, type, def.endIndex, st);
  for (const extra of named(def).filter((c) => c.type === "initialized_identifier")) {
    const [id, ...rest] = named(extra);
    if (id) bind(id.text, rest.length > 0 ? lowerNodes(rest, st) : undefined, type, extra.endIndex, st);
  }
}

/** Assigns `value` to a member or an index (`x.y = v`, `this.f = v`, `m['k'] = v`). */
function memberSet(target: Expr, value: Expr, offset: number, st: DartState): void {
  const cls = st.fn.cls;
  if (target.k === "attr" && target.obj.k === "this" && cls) return addField(cls, target.name, value, st.fn);
  if (target.k === "attr" && target.obj.k === "name") return void (st.fn.attrSets ??= []).push({ target: target.obj.name, name: target.name, value, offset });
  const entry: Expr | undefined = target.k === "index" ? { k: "dict", entries: [{ key: target.key, value }] } : undefined;
  if (target.k === "index" && target.obj.k === "name") return void st.fn.assigns.push({ target: target.obj.name, value: entry!, offset, edit: "merge" });
  // `request.headers['k'] = v`: a key of a local's map member, as that member set to a map (requests.ts)
  if (target.k === "index" && target.obj.k === "attr" && target.obj.obj.k === "name") {
    (st.fn.attrSets ??= []).push({ target: target.obj.obj.name, name: target.obj.name, value: entry!, offset });
  }
  if (target.k === "attr" || target.k === "index") DEEP_SETS.set(st.fn, [...(DEEP_SETS.get(st.fn) ?? []), { target, value, offset }]);
}

/** `x = v`, `x += v`, `x ??= v`, `this.f = v`, `obj.f = v`, `m['k'] = v`: the value is the expression's. */
function lowerAssignment(n: SyntaxNode, st: DartState): Expr {
  const value = lowerNodes(children(n, "right"), st);
  const op = field(n, "operator")?.text ?? "=";
  const left = named(field(n, "left") ?? n).filter((c) => !isComment(c));
  const plain = op === "=" || op === "??=";
  if (left.length === 1 && left[0]!.type === "identifier") {
    const name = left[0]!.text;
    const cls = st.fn.cls;
    if (!isLocal(st.scope, name) && st.cls?.members.has(name) && cls) {
      if (plain) addField(cls, name, value, st.fn);
    } else if (plain || op === "+=") st.fn.assigns.push({ target: name, value, offset: n.endIndex, ...(op === "+=" ? { augmented: true } : {}) });
    return value;
  }
  const target = left.length > 0 ? lowerRun(left, st) : undefined;
  if (target && plain) memberSet(target, value, n.endIndex, st);
  return value;
}

function lowerIf(n: SyntaxNode, st: DartState): void {
  markBranches(n, st.fn, DART_BRANCHES);
  const then = field(n, "consequence");
  lowerNodes(named(n).filter((c) => c.endIndex <= (then?.startIndex ?? n.endIndex)), st);
  if (then) lowerStatement(then, st);
  const alt = field(n, "alternative");
  if (alt) lowerStatement(alt, st);
}

/** `for (final x in xs)`, `for (var i = 0; ...)`, `while`, `do`: the body may not run. */
function lowerLoop(n: SyntaxNode, st: DartState): void {
  markBranches(n, st.fn, DART_BRANCHES);
  const inner = inBlock(st);
  for (const c of named(n)) {
    if (c.type === "for_loop_parts") {
      const name = field(c, "name");
      if (name) inner.scope.names.add(name.text);
      for (const r of runsOf(named(c).filter((x) => x.id !== name?.id))) {
        if (r.length === 1 && r[0]!.type === "local_variable_declaration") lowerStatement(r[0]!, inner);
        else lowerRun(r, inner);
      }
    } else lowerStatement(c, inner);
  }
}

/** Statements and blocks nested in control flow (`switch` cases, `try` and `catch` blocks). */
function lowerNested(n: SyntaxNode, st: DartState): void {
  if (DART_BRANCHES.clauses.has(n.type)) markBranches(n, st.fn, DART_BRANCHES);
  const inner = inBlock(st);
  for (const c of named(n)) {
    if (c.type === "catch_parameters") for (const id of named(c)) inner.scope.names.add(id.text);
    else lowerStatement(c, inner);
  }
}

export function lowerStatement(c: SyntaxNode, st: DartState): void {
  switch (c.type) {
    case "block": {
      const inner = inBlock(st);
      for (const s of named(c)) lowerStatement(s, inner);
      return;
    }
    case "local_variable_declaration":
      for (const d of named(c)) {
        if (d.type === "initialized_variable_definition") lowerVarDef(d, st);
        else lowerOther(d, st);
      }
      return;
    case "expression_statement":
    case "return_statement": {
      const value = lowerNodes(named(c), st);
      if (c.type === "return_statement" && named(c).some((x) => !isComment(x))) st.fn.returns.push(value);
      return;
    }
    case "if_statement":
      return lowerIf(c, st);
    case "for_statement":
    case "while_statement":
    case "do_statement":
      return lowerLoop(c, st);
    case "switch_statement":
    case "switch_block":
    case "switch_statement_case":
    case "switch_statement_default":
    case "try_statement":
    case "catch_clause":
    case "finally_clause":
      return lowerNested(c, st);
    case "local_function_declaration":
      return lowerLocalFunction(c, st);
    default:
      if (!isComment(c)) lowerOther(c, st);
  }
}

/** Parameters: positional, then `[optional]` and `{named}` ones with their defaults; `this.x` and `super.x` name `x`. */
export function lowerParams(list: SyntaxNode | undefined, st: DartState): Param[] {
  const params: Param[] = [];
  const add = (p: SyntaxNode): void => {
    const inner = named(p).find((c) => c.type === "constructor_param" || c.type === "super_formal_parameter");
    const id = field(p, "name") ?? named(inner ?? p).filter((c) => c.type === "identifier").at(-1);
    if (!id) return;
    const type = declaredType(named(p).filter((c) => c.endIndex <= id.startIndex && TYPE_NODES.has(c.type)));
    params.push({ name: id.text, index: params.length, kind: "normal", ...(type ? { type } : {}) });
  };
  for (const c of list ? named(list) : []) {
    if (c.type === "formal_parameter") add(c);
    if (c.type !== "optional_formal_parameters") continue;
    // a default value follows its parameter, as siblings
    let dflt: SyntaxNode[] = [];
    const flush = (): void => {
      if (dflt.length > 0 && params.length > 0) params[params.length - 1]!.default = lowerNodes(dflt, st);
      dflt = [];
    };
    for (const o of named(c)) {
      if (o.type === "formal_parameter") {
        flush();
        add(o);
      } else if (!isComment(o)) dflt.push(o);
    }
    flush();
  }
  return params;
}

/** The parameters `this.x` of a constructor: fields set from the argument. */
export function fieldParams(list: SyntaxNode | undefined): string[] {
  const out: string[] = [];
  for (const p of list ? list.descendantsOfType("constructor_param") : []) {
    const id = p ? named(p).filter((c) => c.type === "identifier").at(-1) : undefined;
    if (id) out.push(id.text);
  }
  return out;
}

/** A function's body: `=> expr` (its return value) or a block. */
export function lowerBody(body: SyntaxNode | undefined, st: DartState): void {
  if (!body) return;
  const kids = named(body).filter((c) => !isComment(c));
  const block = kids.find((c) => c.type === "block");
  if (block) return lowerStatement(block, st);
  if (kids.length > 0) st.fn.returns.push(lowerNodes(kids, st));
}

/** A function's state: its parameters in scope, and the enclosing names when it is a closure. */
export function inFunction(st: DartState, fn: FunctionDef, closure: boolean): DartState {
  return { ...st, fn, scope: { names: new Set(fn.params.map((p) => p.name)), parent: closure ? st.scope : undefined } };
}

/** `(a) => a.b`, `() async { ... }`: a function that sees every name of the function around it. */
function lowerClosure(n: SyntaxNode, st: DartState): FunctionDef {
  const fn = newFunction("closure", st.mod, n, { cls: st.fn.cls, parent: st.fn, inherits: ["*"] });
  st.mod.allFunctions.push(fn);
  fn.params = lowerParams(field(n, "parameters"), st);
  lowerBody(field(n, "body"), inFunction(st, fn, true));
  return fn;
}

/** `void inner() { ... }` in a function: a closure bound to its name. */
function lowerLocalFunction(c: SyntaxNode, st: DartState): void {
  const lambda = named(c).find((x) => x.type === "lambda_expression");
  const sig = lambda ? field(lambda, "parameters") : undefined;
  const name = sig ? field(sig, "name")?.text : undefined;
  if (!lambda || !sig || !name) return void lowerOther(c, st);
  const fn = newFunction(name, st.mod, c, { cls: st.fn.cls, parent: st.fn, inherits: ["*"] });
  st.mod.allFunctions.push(fn);
  fn.params = lowerParams(named(sig).find((x) => x.type === "formal_parameter_list"), st);
  st.scope.names.add(name);
  st.fn.assigns.push({ target: name, value: { k: "fnref", fn }, offset: c.startIndex });
  lowerBody(field(lambda, "body"), inFunction(st, fn, true));
}

setExprHooks({ closure: lowerClosure, assignment: lowerAssignment, statement: lowerStatement, memberSet });
