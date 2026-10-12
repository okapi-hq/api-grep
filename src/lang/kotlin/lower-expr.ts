import type { Arg, CallExpr, Expr } from "../ir/model.js";
import { buildConfigValue } from "../jvm/build-config.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { isEnvMap, special } from "./calls.js";
import { hook, nameRef, posOf, type KtState } from "./state.js";
import { charValue, numberValue, shortTemplate, unescapeKotlin } from "./strings.js";
import { classRef, lowerType } from "./types.js";

const unknown = (n: SyntaxNode): Expr => ({ k: "unknown", text: n.text.slice(0, 80), pos: posOf(n) });

/** `"$base/v1/${id}"`, `"""raw $x"""`: static pieces are `str`, interpolations their expression. */
function lowerString(n: SyntaxNode, st: KtState): Expr {
  const parts: Expr[] = [];
  const push = (s: string): void => {
    const last = parts[parts.length - 1];
    if (last?.k === "str") last.v += s;
    else if (s) parts.push({ k: "str", v: s });
  };
  const kids = named(n);
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i]!;
    if (c.type === "interpolation") {
      const e = named(c)[0];
      parts.push(e ? lowerExpr(e, st) : unknown(c));
    } else if (c.type === "escape_sequence") push(unescapeKotlin(c.text));
    else if (c.type === "string_content") {
      const next = kids[i + 1];
      const short = c.text === "$" && next?.type === "string_content" ? shortTemplate(next.text) : undefined;
      if (!short) push(c.text);
      else {
        parts.push(nameRef(short.name, posOf(next!), st));
        push(short.rest);
        i++;
      }
    }
  }
  if (parts.length === 0) return { k: "str", v: "" };
  return parts.length === 1 && parts[0]!.k === "str" ? parts[0] : { k: "tmpl", parts };
}

function lowerIdentifier(n: SyntaxNode, st: KtState): Expr {
  if (n.text === "true" || n.text === "false") return { k: "bool", v: n.text === "true" };
  if (n.text === "null") return { k: "null" };
  return nameRef(n.text, posOf(n), st);
}

/** `BuildConfig.API_URL` (Android): a build-time configuration value, with the module's literal as its default. */
function buildConfigRead(obj: SyntaxNode, name: string, st: KtState): Expr | undefined {
  const owner = obj.type === "identifier" ? obj.text : obj.type === "navigation_expression" ? named(obj).pop()?.text : undefined;
  if (owner !== "BuildConfig" || !/^[A-Z][A-Z0-9_]*$/.test(name)) return undefined;
  const value = buildConfigValue(st.mod.file, st.rootDir, name);
  return { k: "env", name, ...(value !== undefined ? { fallback: { k: "str", v: value } } : {}) };
}

/** `a.b`, `a?.b`, `X::class` and `X::class.java` (the class itself), `BuildConfig.X`. */
function lowerNavigation(n: SyntaxNode, st: KtState): Expr {
  const kids = named(n);
  const obj = kids[0];
  const member = kids[kids.length - 1];
  if (!obj || kids.length !== 2 || member?.type !== "identifier") return lowerOther(n, st);
  const op = n.children.find((c) => c && !c.isNamed && (c.type === "." || c.type === "?." || c.type === "::"))?.type;
  if (op === "::" && member.text === "class") return classRef(obj) ?? lowerOther(n, st);
  if (member.text === "java" && obj.type === "navigation_expression" && named(obj)[1]?.text === "class") return lowerExpr(obj, st);
  return buildConfigRead(obj, member.text, st) ?? { k: "attr", obj: lowerExpr(obj, st), name: member.text, pos: posOf(member) };
}

/** Arguments: positional, named (`limit = 10`) and spread (`*ids`). */
export function lowerArgs(n: SyntaxNode | undefined, st: KtState): Arg[] {
  return (n ? named(n) : []).flatMap((a): Arg[] => {
    if (a.type !== "value_argument") return [];
    const kids = named(a).filter((c) => !c.type.endsWith("comment"));
    const value = kids[kids.length - 1];
    if (!value) return [];
    if (value.type === "spread_expression") return [{ value: lowerExpr(named(value)[0] ?? value, st), spread: "list" }];
    const isNamed = kids.length === 2 && kids[0]!.type === "identifier" && a.children.some((c) => c?.type === "=");
    return [{ ...(isNamed ? { name: kids[0]!.text } : {}), value: lowerExpr(value, st) }];
  });
}

/** A call; a trailing lambda is its last argument. Calls are recorded in the current function as they are met. */
function lowerCall(n: SyntaxNode, st: KtState): Expr {
  let kids = named(n);
  const lambdaNode = kids.find((c) => c.type === "annotated_lambda");
  const inner = kids[0];
  // the grammar reads `f(a) { ... }` as a call of `f(a)`: it is one call, the lambda its last argument
  if (lambdaNode && inner?.type === "call_expression" && !kids.some((c) => c.type === "value_arguments") && !named(inner).some((c) => c.type === "annotated_lambda")) {
    kids = [...named(inner), lambdaNode];
  }
  const fn = lowerExpr(kids[0]!, st);
  const args = lowerArgs(kids.find((c) => c.type === "value_arguments"), st);
  const lambda = lambdaNode ? hook("lambda")(lambdaNode, st) : undefined;
  if (lambda) args.push({ value: { k: "fnref", fn: lambda.fn } });
  const pos = posOf(n);
  const value = special(fn, args, lambda, pos);
  if (value) return value;
  const call: CallExpr = { k: "call", fn, args, pos };
  st.fn.calls.push(call);
  return call;
}

function lowerBinary(n: SyntaxNode, st: KtState): Expr {
  const op = field(n, "operator")?.text;
  const l = field(n, "left");
  const r = field(n, "right");
  if (!l || !r) return lowerOther(n, st);
  const left = lowerExpr(l, st);
  const right = lowerExpr(r, st);
  if (op === "+") return { k: "concat", parts: [...(left.k === "concat" ? left.parts : [left]), right] };
  if (op === "?:") return { k: "or", left, right };
  return unknown(n);
}

/** `if (c) a else b` as a value: either branch. */
function lowerIf(n: SyntaxNode, st: KtState): Expr {
  const cond = field(n, "condition");
  if (cond) lowerExpr(cond, st);
  const [then, alt] = named(n).filter((c) => c.id !== cond?.id && !c.type.endsWith("comment"));
  const a = then ? hook("statement")(then, st) : unknown(n);
  const b = alt ? hook("statement")(alt, st) : ({ k: "null" } as Expr);
  return { k: "cond", then: a, else: b };
}

/** `when` as a value: any of its branches, the first one first. */
function lowerWhen(n: SyntaxNode, st: KtState): Expr {
  const subject = named(n).find((c) => c.type === "when_subject");
  for (const c of subject ? named(subject) : []) hook("statement")(c, st);
  const values: Expr[] = [];
  for (const entry of named(n).filter((c) => c.type === "when_entry")) {
    const conditions = entry.childrenForFieldName("condition").filter((c): c is SyntaxNode => !!c);
    for (const c of conditions) lowerExpr(c, st);
    const body = named(entry).pop();
    if (body && !conditions.some((c) => c.id === body.id)) values.push(hook("statement")(body, st));
  }
  return values.reduceRight<Expr | undefined>((rest, v) => (rest ? { k: "cond", then: v, else: rest } : v), undefined) ?? unknown(n);
}

/** `try { a } catch (e: E) { b }`: the value of the `try` block; the other blocks still have their calls recorded. */
function lowerTry(n: SyntaxNode, st: KtState): Expr {
  const [body, ...handlers] = named(n);
  const value = body ? hook("statement")(body, st) : unknown(n);
  for (const h of handlers) for (const c of named(h).filter((x) => x.type === "block")) hook("statement")(c, st);
  return value;
}

/** `System.getenv()["X"]`, `config["base"]`. */
function lowerIndex(n: SyntaxNode, st: KtState): Expr {
  const [objNode, keyNode] = named(n);
  const obj = objNode ? lowerExpr(objNode, st) : unknown(n);
  const key = keyNode ? lowerExpr(keyNode, st) : unknown(n);
  if (isEnvMap(obj) && key.k === "str") return { k: "env", name: key.v };
  return { k: "index", obj, key };
}

/** `a to b` is a pair (a two-item list: an entry of `mapOf(...)`); other infix calls are values the scan cannot read. */
function lowerInfix(n: SyntaxNode, st: KtState): Expr {
  const [left, op, right] = named(n);
  if (!left || !right || op?.text !== "to") return lowerOther(n, st);
  return { k: "list", items: [lowerExpr(left, st), lowerExpr(right, st)] };
}

const PASSTHROUGH = new Set(["parenthesized_expression", "labeled_expression", "annotated_expression", "spread_expression"]);

/** Wrappers are their value (`(x)`, `x as T`, `x!!`); anything else still has its calls recorded. */
function lowerOther(n: SyntaxNode, st: KtState): Expr {
  const kids = named(n).filter((c) => !c.type.endsWith("comment") && c.type !== "label" && c.type !== "annotation");
  if (PASSTHROUGH.has(n.type) && kids.length > 0) return lowerExpr(kids[kids.length - 1]!, st);
  if (n.type === "as_expression" && field(n, "left")) return lowerExpr(field(n, "left")!, st);
  if (n.type === "unary_expression" && field(n, "operator")?.text === "!!" && field(n, "argument")) return lowerExpr(field(n, "argument")!, st);
  for (const c of kids) lowerExpr(c, st);
  return unknown(n);
}

/** Lowers a Kotlin expression; calls are recorded in the current function as they are met. */
export function lowerExpr(n: SyntaxNode, st: KtState): Expr {
  switch (n.type) {
    case "string_literal":
    case "multiline_string_literal":
      return lowerString(n, st);
    case "character_literal":
      return { k: "str", v: charValue(n.text) };
    case "number_literal":
    case "float_literal":
      return { k: "num", v: numberValue(n.text) };
    case "identifier":
      return lowerIdentifier(n, st);
    case "this_expression":
      return { k: "this", pos: posOf(n) };
    case "navigation_expression":
      return lowerNavigation(n, st);
    case "call_expression":
      return lowerCall(n, st);
    case "binary_expression":
      return lowerBinary(n, st);
    case "if_expression":
      return lowerIf(n, st);
    case "when_expression":
      return lowerWhen(n, st);
    case "try_expression":
      return lowerTry(n, st);
    case "index_expression":
      return lowerIndex(n, st);
    case "infix_expression":
      return lowerInfix(n, st);
    case "collection_literal":
      return { k: "list", items: named(n).map((c) => lowerExpr(c, st)) };
    default:
      return lowerCompound(n, st);
  }
}

/** Lambdas, anonymous objects, `return`, callable references (`::send`). */
function lowerCompound(n: SyntaxNode, st: KtState): Expr {
  switch (n.type) {
    case "lambda_literal":
    case "annotated_lambda":
    case "anonymous_function":
      return { k: "fnref", fn: hook("lambda")(n, st).fn };
    case "object_literal":
      hook("objectLiteral")(n, st);
      return unknown(n);
    case "return_expression": {
      const label = field(n, "label");
      const value = named(n).find((c) => c.id !== label?.id);
      if (value) st.fn.returns.push(lowerExpr(value, st));
      return unknown(n);
    }
    case "callable_reference": {
      const kids = named(n);
      const id = kids[kids.length - 1];
      if (id?.type !== "identifier") return unknown(n);
      const owner = kids.length > 1 ? lowerType(kids[0]).type : undefined;
      return owner ? { k: "attr", obj: owner, name: id.text, pos: posOf(id) } : nameRef(id.text, posOf(id), st);
    }
    default:
      return lowerOther(n, st);
  }
}
