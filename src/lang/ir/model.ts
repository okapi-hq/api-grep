/**
 * Language-neutral model of a source file, for languages read through tree-sitter (Python, PHP, ...). A front end
 * lowers its syntax tree into these expressions and scopes; detection and resolution only ever see this model, so a new
 * language needs a lowering, its client and SDK tables, and nothing else.
 */

export interface Pos {
  /** 1-based line and column, like the TypeScript report. */
  line: number;
  col: number;
  /** Offset in the file: orders assignments and calls within a scope. */
  offset: number;
}

export interface Arg {
  /** Keyword / named argument (`json=...`, PHP 8 `json: ...`). */
  name?: string;
  value: Expr;
  /** `*args` / `...$args` (list) or `**kwargs` (dict). */
  spread?: "list" | "dict";
}

export interface Entry {
  /** Absent for a positional item of a PHP array (`['a', 'b']`) and for a spread. */
  key?: Expr;
  value: Expr;
  /** `{**base}` / `[...$base]`. */
  spread?: boolean;
}

export type Expr =
  | { k: "str"; v: string }
  | { k: "num"; v: number }
  | { k: "bool"; v: boolean }
  | { k: "null" }
  /** Interpolated string (`f"{base}/x"`, `"$base/x"`): static pieces are `str`. */
  | { k: "tmpl"; parts: Expr[] }
  /** String concatenation (`a + b`, `a . b`). */
  | { k: "concat"; parts: Expr[] }
  /** `a or b`, `a ?? b`, `a ?: b`: the left side, else the right one. */
  | { k: "or"; left: Expr; right: Expr }
  | { k: "cond"; then: Expr; else: Expr }
  /** `"%s/x" % a`, `"{}/x".format(a)`, `sprintf("%s/x", $a)`. */
  | { k: "format"; style: "printf" | "brace"; template: Expr; args: Arg[] }
  /** An environment variable read (`os.getenv("X", "d")`, `getenv('X')`, `env('X', 'd')`) with its default. */
  | { k: "env"; name: string; fallback?: Expr }
  /** An identifier: a local, a parameter, a module name or an import (PHP variables keep their `$`). */
  | { k: "name"; name: string; pos: Pos }
  /** `a.b`, `$a->b`, `A::b`, `A::B`. */
  | { k: "attr"; obj: Expr; name: string; pos: Pos }
  | { k: "index"; obj: Expr; key: Expr }
  | CallExpr
  | { k: "dict"; entries: Entry[] }
  | { k: "list"; items: Expr[] }
  /** `self` in a method, `$this`. */
  | { k: "this"; pos: Pos }
  /** A class reference resolved by the front end (PHP `self::`, `static::` and qualified names): a dotted path. */
  | { k: "qname"; path: string[]; pos: Pos }
  /** A function value: a nested `def`, a lambda or closure assigned to a name. */
  | { k: "fnref"; fn: FunctionDef }
  | { k: "unknown"; text: string; pos?: Pos };

export interface CallExpr {
  k: "call";
  fn: Expr;
  args: Arg[];
  pos: Pos;
  /** `new X(...)` (PHP); a Python class call is a plain call. */
  isNew?: boolean;
}

export interface Assign {
  /** `x`, `$x`, or `this.x` for `self.x = ...` / `$this->x = ...`. */
  target: string;
  value: Expr;
  offset: number;
  /** `x += y` / `$x .= $y`: appends to the previous value. */
  augmented?: boolean;
  /** Declared type (`db: Client = ctx.db`, a PHP `@var` tag): what the value is when it cannot be followed. */
  type?: Expr;
}

export interface Param {
  name: string;
  index: number;
  default?: Expr;
  /** Annotation / declared type, as an expression (`httpx.AsyncClient`, `Optional[OpenAI]`, `StripeClient`). */
  type?: Expr;
  kind: "normal" | "varargs" | "kwargs";
}

export interface FunctionDef {
  name: string;
  params: Param[];
  assigns: Assign[];
  returns: Expr[];
  /** Calls lexically in the body, nested functions aside. */
  calls: CallExpr[];
  module: ModuleModel;
  cls?: ClassDef;
  /** Enclosing function: closures read its names. */
  parent?: FunctionDef;
  /** Names of the enclosing function visible here (Python closures, PHP `fn` and `use (...)`); `*` for all. */
  inherits?: string[];
  pos: Pos;
  /** A Python `@staticmethod` / PHP `static function`: no `self`. */
  isStatic?: boolean;
}

export interface ClassDef {
  name: string;
  /** Dotted qualified name: `app.billing.Client`, `App.Http.Client`. */
  qname: string;
  bases: Expr[];
  methods: Map<string, FunctionDef>;
  /** Class attributes, constants, property defaults, and `self.x = ...` / `$this->x = ...` in any method. */
  fields: Map<string, { value: Expr; fn: FunctionDef }[]>;
  /** Declared types of fields (Python class annotations, PHP typed and promoted properties). */
  fieldTypes: Map<string, Expr>;
  /** Field order with optionality, for request bodies built from a class (dataclass, TypedDict, pydantic). */
  annotations: { name: string; type: Expr; optional: boolean }[];
  module: ModuleModel;
}

export interface ImportRef {
  /** Full dotted path of the imported symbol: `["openai"]`, `["openai", "OpenAI"]`, `["Stripe", "StripeClient"]`. */
  path: string[];
}

export interface ModuleModel {
  /** Absolute path. */
  file: string;
  /** Python: dotted module name from the scanned root (`app.services.billing`); PHP: the namespace. */
  name: string;
  imports: Map<string, ImportRef>;
  /** Every import path, for the SDK coverage (`openai`, `google.genai`, `Stripe.StripeClient`). */
  importPaths: string[][];
  /** Module-level code as a function without parameters. */
  top: FunctionDef;
  functions: Map<string, FunctionDef>;
  classes: Map<string, ClassDef>;
  /** Every function of the file: top level, methods, nested ones. */
  allFunctions: FunctionDef[];
}

export const posOf = (e: Expr): Pos | undefined => ("pos" in e ? e.pos : undefined);

/** A dotted path written as an expression (`a.b.c`): the names, else undefined. */
export function dottedPath(e: Expr): string[] | undefined {
  if (e.k === "name") return [e.name];
  if (e.k === "qname") return e.path;
  if (e.k === "attr") {
    const head = dottedPath(e.obj);
    return head ? [...head, e.name] : undefined;
  }
  return undefined;
}

/** Short readable text for an expression (dynamic part names, diagnostics). */
export function exprText(e: Expr): string {
  switch (e.k) {
    case "name":
      return e.name;
    case "qname":
      return e.path.join(".");
    case "attr":
      return `${exprText(e.obj)}.${e.name}`;
    case "this":
      return "this";
    case "call":
      return `${exprText(e.fn)}()`;
    case "index":
      return `${exprText(e.obj)}[]`;
    case "str":
      return JSON.stringify(e.v);
    default:
      return e.k === "unknown" ? e.text : e.k;
  }
}

/** Direct sub-expressions, for walks over an expression tree. */
export function children(e: Expr): Expr[] {
  switch (e.k) {
    case "tmpl":
    case "concat":
      return e.parts;
    case "or":
      return [e.left, e.right];
    case "cond":
      return [e.then, e.else];
    case "format":
      return [e.template, ...e.args.map((a) => a.value)];
    case "env":
      return e.fallback ? [e.fallback] : [];
    case "attr":
      return [e.obj];
    case "index":
      return [e.obj, e.key];
    case "call":
      return [e.fn, ...e.args.map((a) => a.value)];
    case "dict":
      return e.entries.flatMap((en) => (en.key ? [en.key, en.value] : [en.value]));
    case "list":
      return e.items;
    default:
      return [];
  }
}
