import type { Arg, CallExpr, Entry, Expr, FunctionDef, ModuleModel } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { classPath, constRef, functionRef, posOf, type PhpState } from "./names.js";

export function newFunction(name: string, mod: ModuleModel, n: SyntaxNode, extra: Partial<FunctionDef> = {}): FunctionDef {
  return { name, params: [], assigns: [], returns: [], calls: [], module: mod, pos: posOf(n), ...extra };
}

/** Statement-level lowering that expressions need (closures, assignments in conditions); set by lower.ts. */
export interface StatementHooks {
  closure(n: SyntaxNode, st: PhpState): FunctionDef;
  assignment(n: SyntaxNode, st: PhpState): Expr;
}
let hooks: StatementHooks | undefined;
export function setStatementHooks(h: StatementHooks): void {
  hooks = h;
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", v: "\v", e: "\x1b", f: "\f", "\\": "\\", $: "$", '"': '"', "0": "\0" };

function unescapeDouble(text: string): string {
  return text.replace(/\\(u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/g, (m, c: string) => {
    if (c.startsWith("u{")) return String.fromCodePoint(parseInt(c.slice(2, -1), 16));
    if (c.startsWith("x")) return String.fromCharCode(parseInt(c.slice(1), 16));
    if (/^[0-7]+$/.test(c) && c !== "0") return String.fromCharCode(parseInt(c, 8));
    return ESCAPES[c] ?? m;
  });
}

const STRING_PIECES = new Set(["string_content", "escape_sequence", "nowdoc_string", "string_value"]);

/** `'single'`, `"double $x {$y->z}"`, heredoc and nowdoc: static pieces are `str`, interpolations their expression. */
function lowerString(n: SyntaxNode, st: PhpState): Expr {
  const single = n.type === "string" || n.type === "nowdoc";
  const body = n.type === "heredoc" || n.type === "nowdoc" ? named(n).find((c) => c.type.endsWith("_body")) : n;
  const parts: Expr[] = [];
  for (const c of body ? named(body) : []) {
    if (STRING_PIECES.has(c.type)) {
      const text = single ? c.text.replace(/\\(['\\])/g, "$1") : unescapeDouble(c.text);
      const last = parts[parts.length - 1];
      if (last?.k === "str") last.v += text;
      else parts.push({ k: "str", v: text });
    } else parts.push(lowerExpr(c, st));
  }
  if (n.type === "heredoc" || n.type === "nowdoc") dedent(parts, n);
  if (parts.length === 0) return { k: "str", v: "" };
  return parts.length === 1 && parts[0]!.k === "str" ? parts[0]! : { k: "tmpl", parts };
}

/** A heredoc loses the closing marker's indentation on every line, and its last newline (PHP 7.3+). */
function dedent(parts: Expr[], n: SyntaxNode): void {
  const indent = field(n, "end_tag")?.startPosition.column ?? 0;
  // only the first piece starts a line; later pieces follow an interpolation
  const lineStart = (first: boolean): RegExp => new RegExp(`(${first ? "^|" : ""}\\n)[ \\t]{0,${indent}}`, "g");
  parts.forEach((p, i) => {
    if (p.k === "str") p.v = p.v.replace(lineStart(i === 0), "$1");
  });
  const first = parts[0];
  if (first?.k === "str") first.v = first.v.replace(/^\r?\n/, "");
  const last = parts[parts.length - 1];
  if (last?.k === "str") last.v = last.v.replace(/\r?\n[ \t]*$/, "");
}

function lowerArgs(n: SyntaxNode | undefined, st: PhpState): Arg[] {
  return (n ? named(n) : []).flatMap((a): Arg[] => {
    if (a.type === "variadic_unpacking") return [{ value: lowerExpr(named(a)[0]!, st), spread: "list" }];
    if (a.type !== "argument") return [];
    const nameNode = field(a, "name");
    const valueNode = named(a).filter((c) => c !== nameNode && c.type !== "comment").pop();
    if (!valueNode) return [];
    if (valueNode.type === "variadic_unpacking") return [{ value: lowerExpr(named(valueNode)[0]!, st), spread: "list" }];
    return [{ ...(nameNode ? { name: nameNode.text } : {}), value: lowerExpr(valueNode, st) }];
  });
}

const literalKey = (a: Arg | undefined): string | undefined => (a && a.value.k === "str" ? a.value.v : undefined);

/** `getenv('X')`, Laravel / Symfony `env('X', 'default')`, `sprintf(...)`; anything else is a call. */
function special(name: string, args: Arg[]): Expr | undefined {
  const lower = name.toLowerCase();
  if (lower === "getenv" || lower === "env") {
    const env = literalKey(args[0]);
    if (env === undefined) return undefined;
    const fallback = lower === "env" ? args[1]?.value : undefined;
    return { k: "env", name: env, ...(fallback && fallback.k !== "null" ? { fallback } : {}) };
  }
  if (lower === "sprintf" && args[0] && !args[0].spread) return { k: "format", style: "printf", template: args[0].value, args: args.slice(1) };
  return undefined;
}

function record(call: CallExpr, st: PhpState): CallExpr {
  st.fn.calls.push(call);
  return call;
}

function lowerFunctionCall(n: SyntaxNode, st: PhpState): Expr {
  const fnNode = field(n, "function")!;
  const args = lowerArgs(field(n, "arguments"), st);
  const isName = fnNode.type === "name" || fnNode.type === "qualified_name";
  const fn = isName ? functionRef(fnNode.text, st, posOf(fnNode)) : lowerExpr(fnNode, st);
  const plain = fn.k === "name" ? fn.name : fn.k === "qname" && fn.path.length === 1 ? fn.path[0]! : undefined;
  return (plain ? special(plain, args) : undefined) ?? record({ k: "call", fn, args, pos: posOf(n) }, st);
}

/** `self::X`, `Client::create()`, `$class::make()`: a class written as a scope. */
function scopeExpr(n: SyntaxNode, st: PhpState): Expr {
  if (n.type === "name" || n.type === "qualified_name" || n.type === "relative_scope") return { k: "qname", path: classPath(n.text, st), pos: posOf(n) };
  return lowerExpr(n, st);
}

function lowerMember(n: SyntaxNode, st: PhpState): Expr {
  const obj = lowerExpr(field(n, "object")!, st);
  const nameNode = field(n, "name")!;
  const member: Expr = { k: "attr", obj, name: nameNode.text.replace(/^\$/, ""), pos: posOf(nameNode) };
  if (!n.type.endsWith("call_expression")) return member;
  return record({ k: "call", fn: member, args: lowerArgs(field(n, "arguments"), st), pos: posOf(n) }, st);
}

function lowerScoped(n: SyntaxNode, st: PhpState): Expr {
  const scope = scopeExpr(field(n, "scope") ?? named(n)[0]!, st);
  const nameNode = field(n, "name") ?? named(n)[named(n).length - 1]!;
  if (n.type === "class_constant_access_expression" && nameNode.text === "class" && scope.k === "qname") return { k: "str", v: scope.path.join("\\") };
  const member: Expr = { k: "attr", obj: scope, name: nameNode.text.replace(/^\$/, ""), pos: posOf(nameNode) };
  if (n.type !== "scoped_call_expression") return member;
  return record({ k: "call", fn: member, args: lowerArgs(field(n, "arguments"), st), pos: posOf(n) }, st);
}

function lowerNew(n: SyntaxNode, st: PhpState): Expr {
  const cls = named(n).find((c) => c.type !== "arguments");
  if (!cls || cls.type === "anonymous_class") return { k: "unknown", text: "new class", pos: posOf(n) };
  const fn = cls.type === "name" || cls.type === "qualified_name" ? scopeExpr(cls, st) : lowerExpr(cls, st);
  return record({ k: "call", fn, args: lowerArgs(named(n).find((c) => c.type === "arguments"), st), pos: posOf(n), isNew: true }, st);
}

function lowerArray(n: SyntaxNode, st: PhpState): Expr {
  const entries: Entry[] = [];
  for (const el of named(n).filter((c) => c.type === "array_element_initializer")) {
    const kids = named(el);
    if (kids[0]?.type === "variadic_unpacking") entries.push({ value: lowerExpr(named(kids[0])[0]!, st), spread: true });
    else if (kids.length >= 2) entries.push({ key: lowerExpr(kids[0]!, st), value: lowerExpr(kids[1]!, st) });
    else if (kids[0]) entries.push({ value: lowerExpr(kids[0], st) });
  }
  if (entries.length > 0 && entries.every((e) => !e.key && !e.spread)) return { k: "list", items: entries.map((e) => e.value) };
  return { k: "dict", entries };
}

function lowerBinary(n: SyntaxNode, st: PhpState): Expr {
  const op = field(n, "operator")?.text;
  const left = lowerExpr(field(n, "left")!, st);
  const right = lowerExpr(field(n, "right")!, st);
  if (op === ".") return { k: "concat", parts: [...(left.k === "concat" ? left.parts : [left]), right] };
  if (op === "??") return { k: "or", left, right };
  return { k: "unknown", text: n.text.slice(0, 80), pos: posOf(n) };
}

function lowerConditional(n: SyntaxNode, st: PhpState): Expr {
  const cond = lowerExpr(field(n, "condition")!, st);
  const body = field(n, "body");
  const alt = lowerExpr(field(n, "alternative")!, st);
  return body ? { k: "cond", then: lowerExpr(body, st), else: alt } : { k: "or", left: cond, right: alt };
}

/** `$_ENV['X']`, `$_SERVER['X']`, `$config['base']`. */
function lowerSubscript(n: SyntaxNode, st: PhpState): Expr {
  const [objNode, keyNode] = named(n);
  if (objNode?.type === "variable_name" && /^\$?_(?:ENV|SERVER)$/.test(objNode.text) && keyNode) {
    const k = lowerExpr(keyNode, st);
    if (k.k === "str") return { k: "env", name: k.v };
  }
  return { k: "index", obj: objNode ? lowerExpr(objNode, st) : { k: "unknown", text: "" }, key: keyNode ? lowerExpr(keyNode, st) : { k: "unknown", text: "" } };
}

function lowerVariable(n: SyntaxNode): Expr {
  const name = n.text.startsWith("$") ? n.text : `$${n.text}`;
  return name === "$this" ? { k: "this", pos: posOf(n) } : { k: "name", name, pos: posOf(n) };
}

function lowerLiteral(n: SyntaxNode): Expr | undefined {
  switch (n.type) {
    case "integer":
    case "float": {
      const v = Number(n.text.replace(/_/g, ""));
      return { k: "num", v: Number.isFinite(v) ? v : 0 };
    }
    case "boolean":
      return { k: "bool", v: n.text.toLowerCase() === "true" };
    case "null":
      return { k: "null" };
    default:
      return undefined;
  }
}

const PASSTHROUGH = new Set(["parenthesized_expression", "cast_expression", "error_suppression_expression", "reference_modifier", "by_ref"]);

/** Lowers a PHP expression; calls are recorded in the current function as they are met. */
export function lowerExpr(n: SyntaxNode, st: PhpState): Expr {
  const lit = lowerLiteral(n);
  if (lit) return lit;
  switch (n.type) {
    case "string":
    case "encapsed_string":
    case "heredoc":
    case "nowdoc":
      return lowerString(n, st);
    case "variable_name":
      return lowerVariable(n);
    case "name":
    case "qualified_name":
      return constRef(n.text, st, posOf(n));
    case "function_call_expression":
      return lowerFunctionCall(n, st);
    case "member_access_expression":
    case "nullsafe_member_access_expression":
    case "member_call_expression":
    case "nullsafe_member_call_expression":
      return lowerMember(n, st);
    case "scoped_call_expression":
    case "scoped_property_access_expression":
    case "class_constant_access_expression":
      return lowerScoped(n, st);
    case "object_creation_expression":
      return lowerNew(n, st);
    case "array_creation_expression":
      return lowerArray(n, st);
    case "binary_expression":
      return lowerBinary(n, st);
    case "conditional_expression":
      return lowerConditional(n, st);
    case "subscript_expression":
      return lowerSubscript(n, st);
    case "anonymous_function":
    case "arrow_function":
      return hooks ? { k: "fnref", fn: hooks.closure(n, st) } : { k: "unknown", text: "closure" };
    case "assignment_expression":
    case "augmented_assignment_expression":
      return hooks ? hooks.assignment(n, st) : lowerOther(n, st);
    default:
      return lowerOther(n, st);
  }
}

/** Parentheses and casts are their value; anything else still has its calls recorded. */
function lowerOther(n: SyntaxNode, st: PhpState): Expr {
  const kids = named(n).filter((c) => c.type !== "comment");
  if (PASSTHROUGH.has(n.type)) {
    const value = field(n, "value") ?? kids[kids.length - 1];
    if (value) return lowerExpr(value, st);
  }
  for (const c of kids) lowerExpr(c, st);
  return { k: "unknown", text: n.text.slice(0, 80), pos: posOf(n) };
}
