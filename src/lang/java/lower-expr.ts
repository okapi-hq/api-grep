import type { Arg, CallExpr, Expr } from "../ir/model.js";
import { buildConfigValue } from "../jvm/build-config.js";
import { appends } from "../jvm/calls.js";
import type { SyntaxNode } from "../tree-sitter.js";
import { special, urlFromParts } from "./calls.js";
import { hook, named, nameRef, posOf, type JState } from "./state.js";
import { charValue, numberValue, textBlock, unescapeJava } from "./strings.js";
import { classRef, expressionPath, lowerType, typePath } from "./types.js";

export const unknown = (n: SyntaxNode): Expr => ({ k: "unknown", text: n.text.slice(0, 80), pos: posOf(n) });

/** `"a\tb"` and text blocks; a string template's embedded expressions (`STR."\{x}"`) are its parts. */
function lowerString(n: SyntaxNode, st: JState): Expr {
  if (n.text.startsWith('"""')) return { k: "str", v: textBlock(n.text) };
  const parts: Expr[] = [];
  let text = "";
  for (const c of named(n)) {
    if (c.type === "string_interpolation") {
      if (text) parts.push({ k: "str", v: text });
      text = "";
      const e = named(c)[0];
      parts.push(e ? lowerExpr(e, st) : unknown(c));
    } else text += c.type === "escape_sequence" ? unescapeJava(c.text) : c.text;
  }
  if (parts.length === 0) return { k: "str", v: text };
  if (text) parts.push({ k: "str", v: text });
  return { k: "tmpl", parts };
}

/** `BuildConfig.API_URL` (Android): a build-time configuration value, with the module's literal as its default. */
function buildConfigRead(obj: SyntaxNode, name: string, st: JState): Expr | undefined {
  const owner = expressionPath(obj)?.pop();
  if (owner !== "BuildConfig" || !/^[A-Z][A-Z0-9_]*$/.test(name)) return undefined;
  const value = buildConfigValue(st.mod.file, st.rootDir, name);
  return { k: "env", name, ...(value !== undefined ? { fallback: { k: "str", v: value } } : {}) };
}

/** `a.b`, `this.b`, `Outer.this` (the enclosing object), `BuildConfig.X`; `super.b` is not followed. */
function lowerFieldAccess(n: SyntaxNode, st: JState): Expr {
  const obj = n.childForFieldName("object");
  const field = n.childForFieldName("field");
  if (!obj || !field) return unknown(n);
  if (field.type === "this") return { k: "this", pos: posOf(n) };
  if (obj.type === "super") return unknown(n);
  return buildConfigRead(obj, field.text, st) ?? { k: "attr", obj: lowerExpr(obj, st), name: field.text, pos: posOf(field) };
}

export function lowerArgs(n: SyntaxNode | undefined, st: JState): Arg[] {
  return (n ? named(n) : []).map((a) => ({ value: lowerExpr(a, st) }));
}

/** `sb.toString()` of a `StringBuilder` local filled by statements before it: what was appended so far. */
function builtLocal(call: CallExpr, st: JState): Expr | undefined {
  if (call.fn.k !== "attr" || call.fn.name !== "toString" || call.fn.obj.k !== "name") return undefined;
  const parts = st.builders.get(call.fn.obj.name);
  return parts ? { k: "concat", parts: [...parts] } : undefined;
}

/** `sb.append(a).append(b);` as a statement, on a `StringBuilder` local: its parts grow. */
export function recordAppends(call: CallExpr, st: JState): void {
  const chain = appends(call);
  if (chain?.root?.k === "name") st.builders.get(chain.root.name)?.push(...chain.items);
}

/** A method call; bare names are members of the class first (`this.send(...)`). Calls are recorded as they are met. */
function lowerInvocation(n: SyntaxNode, st: JState): Expr {
  const obj = n.childForFieldName("object");
  const name = n.childForFieldName("name");
  if (!name) return unknown(n);
  const pos = posOf(n);
  const fn: Expr = !obj ? nameRef(name.text, posOf(name), st) : obj.type === "super" ? { k: "attr", obj: unknown(obj), name: name.text, pos: posOf(name) } : { k: "attr", obj: lowerExpr(obj, st), name: name.text, pos: posOf(name) };
  const call: CallExpr = { k: "call", fn, args: lowerArgs(n.childForFieldName("arguments") ?? undefined, st), pos };
  const value = special(call) ?? builtLocal(call, st);
  if (value) return value;
  st.fn.calls.push(call);
  return call;
}

/** `new X(args)` is a call of `X`; an anonymous class body stands for its only method (`new Interceptor() { ... }`). */
function lowerNew(n: SyntaxNode, st: JState): Expr {
  const typeNode = n.childForFieldName("type");
  const path = typeNode ? typePath(typeNode) : undefined;
  const args = lowerArgs(n.childForFieldName("arguments") ?? undefined, st);
  const body = named(n).find((c) => c.type === "class_body");
  if (body) {
    const only = hook("anonymousClass")(body, st);
    return only ? { k: "fnref", fn: only } : unknown(n);
  }
  if (!path || !typeNode) return unknown(n);
  const call: CallExpr = { k: "call", fn: classRef(typeNode, st) ?? unknown(typeNode), args, pos: posOf(n), isNew: true };
  const url = urlFromParts(call);
  if (url) return url;
  st.fn.calls.push(call);
  return call;
}

/**
 * `a + b + c`, `x == 1 && y == 2 && ...`: binary operators nest down their left side, thousands deep in generated
 * code, so the left spine is walked in a loop rather than by recursion.
 */
function lowerBinary(n: SyntaxNode, st: JState): Expr {
  const spine: SyntaxNode[] = [];
  let leftmost: SyntaxNode | null = n;
  while (leftmost?.type === "binary_expression") {
    spine.push(leftmost);
    leftmost = leftmost.childForFieldName("left");
  }
  let value: Expr | undefined = leftmost ? lowerExpr(leftmost, st) : undefined;
  for (const b of spine.reverse()) {
    const r = b.childForFieldName("right");
    const right = r ? lowerExpr(r, st) : undefined;
    const plus = b.childForFieldName("operator")?.text === "+";
    value = value && right && plus ? { k: "concat", parts: [...(value.k === "concat" ? value.parts : [value]), right] } : unknown(b);
  }
  return value ?? unknown(n);
}

/** Lowers a Java expression; calls are recorded in the current function as they are met. */
export function lowerExpr(n: SyntaxNode, st: JState): Expr {
  switch (n.type) {
    case "string_literal":
      return lowerString(n, st);
    case "character_literal":
      return { k: "str", v: charValue(n.text) };
    case "decimal_integer_literal":
    case "hex_integer_literal":
    case "octal_integer_literal":
    case "binary_integer_literal":
    case "decimal_floating_point_literal":
    case "hex_floating_point_literal":
      return { k: "num", v: numberValue(n.text) };
    case "true":
    case "false":
      return { k: "bool", v: n.type === "true" };
    case "null_literal":
      return { k: "null" };
    case "identifier":
      return nameRef(n.text, posOf(n), st);
    case "this":
      return { k: "this", pos: posOf(n) };
    case "field_access":
      return lowerFieldAccess(n, st);
    case "method_invocation":
      return lowerInvocation(n, st);
    case "object_creation_expression":
      return lowerNew(n, st);
    default:
      return lowerCompound(n, st);
  }
}

/** Operators, conditionals, lambdas, references and wrappers (`(x)`, `(T) x`). */
function lowerCompound(n: SyntaxNode, st: JState): Expr {
  const value = n.childForFieldName("value");
  switch (n.type) {
    case "binary_expression":
      return lowerBinary(n, st);
    case "ternary_expression": {
      const cond = n.childForFieldName("condition");
      if (cond) lowerExpr(cond, st);
      const [a, b] = [n.childForFieldName("consequence"), n.childForFieldName("alternative")];
      return { k: "cond", then: a ? lowerExpr(a, st) : unknown(n), else: b ? lowerExpr(b, st) : unknown(n) };
    }
    case "parenthesized_expression":
      return named(n)[0] ? lowerExpr(named(n)[0]!, st) : unknown(n);
    case "cast_expression":
      return value ? lowerExpr(value, st) : unknown(n);
    case "assignment_expression":
      return hook("assignment")(n, st);
    case "lambda_expression":
      return { k: "fnref", fn: hook("lambda")(n, st) };
    default:
      return lowerOther(n, st);
  }
}

/** Class literals, method references, arrays, `switch` values; anything else still has its calls recorded. */
function lowerOther(n: SyntaxNode, st: JState): Expr {
  switch (n.type) {
    case "class_literal":
      return (named(n)[0] && classRef(named(n)[0]!, st)) ?? unknown(n);
    case "method_reference": {
      const [owner, member] = named(n);
      if (!owner || member?.type !== "identifier") return unknown(n);
      const obj = owner.type === "identifier" || owner.type === "field_access" ? lowerExpr(owner, st) : (lowerType(owner, st) ?? unknown(owner));
      return { k: "attr", obj, name: member.text, pos: posOf(member) };
    }
    case "array_initializer":
      return { k: "list", items: named(n).map((c) => lowerExpr(c, st)) };
    case "array_creation_expression": {
      const init = n.childForFieldName("value");
      // `new byte[] {0x78, 0}` is binary data, not a list a body would serialize
      const bytes = n.childForFieldName("type")?.text === "byte";
      const value = init ? lowerExpr(init, st) : undefined;
      return value && !bytes ? value : unknown(n);
    }
    case "array_access": {
      const [a, i] = [n.childForFieldName("array"), n.childForFieldName("index")];
      return a && i ? { k: "index", obj: lowerExpr(a, st), key: lowerExpr(i, st) } : unknown(n);
    }
    case "switch_expression":
      return hook("switchValue")(n, st);
    default:
      for (const c of named(n)) lowerExpr(c, st);
      return unknown(n);
  }
}
