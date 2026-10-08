import type { Arg, CallExpr, Entry, Expr, FunctionDef, ModuleModel, Pos } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";

/** Lowering state: the module, the function whose calls are being collected, and the method receiver (`self`, `cls`). */
export interface PyState {
  mod: ModuleModel;
  fn: FunctionDef;
  receiver?: string;
}

export function posOf(n: SyntaxNode): Pos {
  return { line: n.startPosition.row + 1, col: n.startPosition.column + 1, offset: n.startIndex };
}

export function newFunction(name: string, mod: ModuleModel, n: SyntaxNode, extra: Partial<FunctionDef> = {}): FunctionDef {
  return { name, params: [], assigns: [], returns: [], calls: [], module: mod, pos: posOf(n), ...extra };
}

/** `lambda m: f"https://api.telegram.org/bot{t}/{m}"`: a function returning its body, closing over the enclosing scope. */
function lowerLambda(n: SyntaxNode, st: PyState): Expr {
  const fn = newFunction("lambda", st.mod, n, { cls: st.fn.cls, parent: st.fn, inherits: ["*"] });
  st.mod.allFunctions.push(fn);
  const params = field(n, "parameters");
  fn.params = (params ? named(params) : []).flatMap((c, i) => {
    const name = c.type === "identifier" ? c.text : field(c, "name")?.text;
    const dflt = field(c, "value");
    return name ? [{ name, index: i, kind: "normal" as const, ...(dflt ? { default: lowerExpr(dflt, st) } : {}) }] : [];
  });
  const body = field(n, "body");
  if (body) fn.returns.push(lowerExpr(body, { ...st, fn }));
  return { k: "fnref", fn };
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', "0": "\0" };

function unescape(text: string): string {
  return text.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (m, c: string) => {
    if (c.length > 1) return String.fromCharCode(parseInt(c.slice(1), 16));
    return ESCAPES[c] ?? m;
  });
}

/** `"..."`, `f"...{x}..."`, `r"..."`: static pieces are `str`, interpolations their expression. */
function lowerString(n: SyntaxNode, st: PyState): Expr {
  const prefix = (named(n).find((c) => c.type === "string_start")?.text ?? "").toLowerCase();
  const isF = prefix.includes("f");
  const isRaw = prefix.includes("r");
  const parts: Expr[] = [];
  for (const c of named(n)) {
    if (c.type === "string_content") {
      let text = isRaw ? c.text : unescape(c.text);
      if (isF) text = text.replace(/\{\{/g, "{").replace(/\}\}/g, "}");
      parts.push({ k: "str", v: text });
    } else if (c.type === "interpolation") {
      const e = field(c, "expression");
      parts.push(e ? lowerExpr(e, st) : { k: "unknown", text: c.text });
    }
  }
  if (parts.length === 0) return { k: "str", v: "" };
  if (parts.every((p) => p.k === "str")) return { k: "str", v: parts.map((p) => (p as { v: string }).v).join("") };
  return { k: "tmpl", parts };
}

function lowerNumber(n: SyntaxNode): Expr {
  const text = n.text.replace(/_/g, "").replace(/[jJlL]$/, "");
  const v = /^0[xob]/i.test(text) ? Number(text) : Number.parseFloat(text);
  return { k: "num", v: Number.isFinite(v) ? v : 0 };
}

function lowerArgs(list: SyntaxNode | undefined, st: PyState): Arg[] {
  if (!list || list.type !== "argument_list") return list ? [{ value: lowerExpr(list, st) }] : [];
  return named(list).flatMap((c): Arg[] => {
    if (c.type === "keyword_argument") {
      const value = field(c, "value");
      return [{ name: field(c, "name")?.text, value: value ? lowerExpr(value, st) : { k: "unknown", text: c.text } }];
    }
    if (c.type === "list_splat") return [{ value: lowerExpr(named(c)[0]!, st), spread: "list" }];
    if (c.type === "dictionary_splat") return [{ value: lowerExpr(named(c)[0]!, st), spread: "dict" }];
    if (c.type === "comment") return [];
    return [{ value: lowerExpr(c, st) }];
  });
}

const literalKey = (a: Arg | undefined): string | undefined => (a && !a.name && a.value.k === "str" ? a.value.v : undefined);

/** `os.getenv("X", d)`, `os.environ.get("X", d)`, `environ.get(...)`, decouple `config("X", default=d)`, django-environ `env("X")`. */
function envCall(callee: string, args: Arg[], st: PyState): Expr | undefined {
  const isEnv =
    /^(?:os\.)?(?:getenv|environ\.get)$/.test(callee) ||
    (/^(?:config|env(?:\.\w+)?)$/.test(callee) && ["decouple", "environ"].includes(st.mod.imports.get(callee.split(".")[0]!)?.path[0] ?? ""));
  if (!isEnv) return undefined;
  const name = literalKey(args[0]);
  if (name === undefined) return undefined;
  const fallback = args.find((a) => a.name === "default")?.value ?? args.filter((a) => !a.name)[1]?.value;
  return { k: "env", name, ...(fallback && fallback.k !== "null" ? { fallback } : {}) };
}

function dotted(e: Expr): string | undefined {
  if (e.k === "name") return e.name;
  if (e.k === "attr") {
    const head = dotted(e.obj);
    return head ? `${head}.${e.name}` : undefined;
  }
  return undefined;
}

function lowerCall(n: SyntaxNode, st: PyState): Expr {
  const fnNode = field(n, "function");
  const fn = fnNode ? lowerExpr(fnNode, st) : ({ k: "unknown", text: "" } as Expr);
  const args = lowerArgs(field(n, "arguments"), st);
  const callee = dotted(fn);
  const env = callee ? envCall(callee, args, st) : undefined;
  if (env) return env;
  if (fn.k === "attr" && fn.name === "format" && (fn.obj.k === "str" || fn.obj.k === "name" || fn.obj.k === "attr")) {
    return { k: "format", style: "brace", template: fn.obj, args };
  }
  const call: CallExpr = { k: "call", fn, args, pos: posOf(n) };
  st.fn.calls.push(call);
  return call;
}

function lowerSubscript(n: SyntaxNode, st: PyState): Expr {
  const value = field(n, "value");
  const sub = field(n, "subscript");
  const obj = value ? lowerExpr(value, st) : ({ k: "unknown", text: "" } as Expr);
  const key = sub ? lowerExpr(sub, st) : ({ k: "unknown", text: "" } as Expr);
  const base = dotted(obj);
  if ((base === "os.environ" || base === "environ") && key.k === "str") return { k: "env", name: key.v };
  return { k: "index", obj, key };
}

function lowerBinary(n: SyntaxNode, st: PyState): Expr {
  const op = field(n, "operator")?.text;
  const left = lowerExpr(field(n, "left")!, st);
  const right = lowerExpr(field(n, "right")!, st);
  if (op === "+") return { k: "concat", parts: [...(left.k === "concat" ? left.parts : [left]), right] };
  if (op === "%" && (left.k === "str" || left.k === "tmpl" || left.k === "name" || left.k === "attr")) {
    const args: Arg[] = right.k === "list" ? right.items.map((value) => ({ value })) : [{ value: right }];
    return { k: "format", style: "printf", template: left, args };
  }
  if (op === "|") return { k: "or", left, right };
  return { k: "unknown", text: n.text.slice(0, 80), pos: posOf(n) };
}

function lowerDict(n: SyntaxNode, st: PyState): Expr {
  const entries: Entry[] = [];
  for (const c of named(n)) {
    if (c.type === "pair") entries.push({ key: lowerExpr(field(c, "key")!, st), value: lowerExpr(field(c, "value")!, st) });
    else if (c.type === "dictionary_splat") entries.push({ value: lowerExpr(named(c)[0]!, st), spread: true });
  }
  return { k: "dict", entries };
}

function lowerSequence(n: SyntaxNode, st: PyState): Expr {
  return { k: "list", items: named(n).filter((c) => c.type !== "comment").map((c) => (c.type === "list_splat" ? lowerExpr(named(c)[0]!, st) : lowerExpr(c, st))) };
}

function lowerIdentifier(n: SyntaxNode, st: PyState): Expr {
  if (st.receiver && n.text === st.receiver) return { k: "this", pos: posOf(n) };
  return { k: "name", name: n.text, pos: posOf(n) };
}

function lowerCompound(n: SyntaxNode, st: PyState): Expr | undefined {
  switch (n.type) {
    case "conditional_expression": {
      const [a, , b] = named(n);
      return { k: "cond", then: lowerExpr(a!, st), else: lowerExpr(b!, st) };
    }
    case "boolean_operator":
      return field(n, "operator")?.text === "or" ? { k: "or", left: lowerExpr(field(n, "left")!, st), right: lowerExpr(field(n, "right")!, st) } : undefined;
    case "parenthesized_expression":
    case "await":
    case "type":
      return named(n)[0] ? lowerExpr(named(n)[0]!, st) : undefined;
    case "named_expression":
      return field(n, "value") ? lowerExpr(field(n, "value")!, st) : undefined;
    case "lambda":
      return lowerLambda(n, st);
    case "concatenated_string": {
      const parts = named(n).map((c) => lowerExpr(c, st));
      return parts.every((p) => p.k === "str") ? { k: "str", v: parts.map((p) => (p as { v: string }).v).join("") } : { k: "tmpl", parts };
    }
    default:
      return undefined;
  }
}

/** Lowers a Python expression; calls are recorded in the current function as they are met. */
export function lowerExpr(n: SyntaxNode, st: PyState): Expr {
  switch (n.type) {
    case "string":
      return lowerString(n, st);
    case "integer":
    case "float":
      return lowerNumber(n);
    case "true":
    case "false":
      return { k: "bool", v: n.type === "true" };
    case "none":
      return { k: "null" };
    case "identifier":
      return lowerIdentifier(n, st);
    case "attribute":
      return { k: "attr", obj: lowerExpr(field(n, "object")!, st), name: field(n, "attribute")!.text, pos: posOf(field(n, "attribute")!) };
    case "subscript":
      return lowerSubscript(n, st);
    case "call":
      return lowerCall(n, st);
    case "binary_operator":
      return lowerBinary(n, st);
    case "dictionary":
      return lowerDict(n, st);
    case "list":
    case "tuple":
    case "set":
    case "expression_list":
      return lowerSequence(n, st);
    default:
      return lowerCompound(n, st) ?? lowerOther(n, st);
  }
}

/** Anything else still has its calls recorded (comprehensions, lambdas, unary operators). */
function lowerOther(n: SyntaxNode, st: PyState): Expr {
  for (const c of named(n)) if (c.type !== "comment") lowerExpr(c, st);
  return { k: "unknown", text: n.text.slice(0, 80), pos: posOf(n) };
}
