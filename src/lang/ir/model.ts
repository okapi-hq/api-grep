/**
 * Language-neutral model of a source file, for languages read through tree-sitter (Python, PHP, Kotlin). A front end
 * lowers its syntax tree into these expressions and scopes; detection and resolution only ever see this model, so a new
 * language needs a lowering, its client and SDK tables, and nothing else.
 */

import type { Language } from "../../report/schema.js";
import type { ValueSource } from "../../types.js";

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
  /** Set on some paths only (a key added in a branch, see `edits.ts`): not a required key. */
  optional?: boolean;
}

export type Expr =
  /** `src`: a value read from a config file the code loads (`config-load.ts`), not written in the code. */
  | { k: "str"; v: string; src?: ValueSource }
  | { k: "num"; v: number }
  | { k: "bool"; v: boolean }
  | { k: "null" }
  /** Interpolated string (`f"{base}/x"`, `"$base/x"`): static pieces are `str`. */
  | { k: "tmpl"; parts: Expr[] }
  /** String concatenation (`a + b`, `a . b`). */
  | { k: "concat"; parts: Expr[] }
  /** `a or b`, `a ?? b`, `a ?: b`: the left side, else the right one. */
  | { k: "or"; left: Expr; right: Expr }
  /** `match`: one of the arms of a Rust `match`, lowered as a chain of these, each marked (a host table, `resolve/choice.ts`). */
  | { k: "cond"; then: Expr; else: Expr; match?: boolean }
  /** `"%s/x" % a`, `"{}/x".format(a)`, `sprintf("%s/x", $a)`. */
  | { k: "format"; style: "printf" | "brace"; template: Expr; args: Arg[] }
  /** An environment variable read (`os.getenv("X", "d")`, `getenv('X')`, `env('X', 'd')`) with its default. */
  | { k: "env"; name: string; fallback?: Expr }
  /**
   * An identifier: a local, a parameter, a module name or an import (PHP variables keep their `$`). `implicit`: a bare
   * name in a Kotlin extension function, a member of its receiver when nothing else declares it.
   */
  | { k: "name"; name: string; pos: Pos; implicit?: boolean }
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
  /** An expression of another function, read in that function's scope: the engine builds these when it puts together
   *  a request from pieces written in several places (a URL builder's base and its query parameters). */
  | { k: "scoped"; expr: Expr; fn: FunctionDef }
  | { k: "unknown"; text: string; pos?: Pos };

export interface CallExpr {
  k: "call";
  fn: Expr;
  args: Arg[];
  pos: Pos;
  /** `new X(...)` (PHP); a Python class call is a plain call. */
  isNew?: boolean;
  /** Type arguments as written (Kotlin `retrofit.create<Api>()`), as type expressions. */
  typeArgs?: Expr[];
  /**
   * Lambdas run on this call's value by Kotlin `apply { ... }` / `also { ... }`, which stand for the value itself:
   * their calls on it are steps of a builder (`Request.Builder().apply { url(u) }`).
   */
  applied?: FunctionDef[];
  /** An attribute read that sends a request (web3.py `w3.eth.block_number`, #78): matches registry `property` entries only. */
  property?: boolean;
  /** Members a Dart cascade sets on the call's value (`PostHogConfig(k)..host = h`), in order. */
  sets?: { name: string; value: Expr }[];
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
  /**
   * Changes the keys of the dict `target` holds rather than replacing it (`edits.ts`): `merge` adds the entries of the
   * dict `value` (`kwargs["k"] = v`, `.update(...)`, `|=`), `default` adds those not set yet (`.setdefault`, PHP `+=`),
   * `remove` drops the keys listed in `value` (`del kwargs["k"]`, `.pop("k")`, `unset(...)`).
   */
  edit?: "merge" | "default" | "remove";
}

export interface Branch {
  start: number;
  end: number;
  /** One of the `size` branches of an `if` / `elif` / `else` chain with an `else`: exactly one of them runs. */
  group?: { id: number; size: number };
}

/** A JVM annotation (`@GET("users/{id}")`, `@Query("page")`): its class as written, resolved like a name, and its arguments. */
export interface Annotation {
  type: Expr;
  args: Arg[];
  pos: Pos;
}

export interface Param {
  name: string;
  index: number;
  default?: Expr;
  /** Annotation / declared type, as an expression (`httpx.AsyncClient`, `Optional[OpenAI]`, `StripeClient`). */
  type?: Expr;
  kind: "normal" | "varargs" | "kwargs";
  annotations?: Annotation[];
}

export interface FunctionDef {
  name: string;
  params: Param[];
  assigns: Assign[];
  returns: Expr[];
  /** Calls lexically in the body, nested functions aside. */
  calls: CallExpr[];
  /** Attribute reads named like a registry `property` entry, as calls without arguments (see `CallExpr.property`). */
  reads?: CallExpr[];
  module: ModuleModel;
  cls?: ClassDef;
  /** Enclosing function: closures read its names. */
  parent?: FunctionDef;
  /** Names of the enclosing function visible here (Python closures, PHP `fn` and `use (...)`); `*` for all. */
  inherits?: string[];
  pos: Pos;
  /** A Python `@staticmethod` / PHP `static function`: no `self`. */
  isStatic?: boolean;
  /** Values a Python generator yields (`yield client` in a FastAPI dependency). */
  yields?: Expr[];
  /** A Python `@property` / `@cached_property`: reading the attribute runs it, `self.client` is what it returns. */
  isProperty?: boolean;
  /** Offsets of blocks that may not run (branches, loop bodies, handlers), for the keys a dict gets there. */
  branches?: Branch[];
  annotations?: Annotation[];
  /** The declared return type (`fun client(): OkHttpClient`), what a DI provider provides. */
  returnType?: Expr;
  /**
   * The receiver of a Kotlin extension function (`fun S3Client.delete(...)`): a parameter named `this`, of the
   * receiver's type, kept out of `params` (positions, overloads); a call gives it its object (`receiverArg`).
   */
  receiver?: Param;
  /**
   * A Kotlin lambda's assignments to names it does not declare (`bucket = b`, `this.key = k`): properties of its
   * implicit receiver when it fills a DSL builder (`PutObjectRequest { bucket = b }`), in order.
   */
  props?: { name: string; value: Expr; offset: number }[];
  /**
   * Attributes set on a local variable (`product.title = t`, not `self.x`), in order: what a record it holds is given
   * one by one before it is saved (#102).
   */
  attrSets?: { target: string; name: string; value: Expr; offset: number }[];
  /**
   * Loops over a collection (`for (Interceptor i : interceptors)`, `for (i in interceptors)`): the variable is each
   * element of `over` between `from` and `to` (the loop's offsets). Read where one element stands for all
   * (interceptors added in the loop), never as the variable's value.
   */
  loops?: { name: string; over: Expr; from: number; to: number }[];
  /**
   * `return` statements (Kotlin and Java), for the code after an early return that may not run (a header an
   * interceptor sets after `if (x) return chain.proceed(request)`). `maybe`: one that runs on some paths only
   * wherever it is (`x ?: return ...`).
   */
  exits?: { offset: number; maybe?: boolean }[];
  /** A lambda run on some paths only (`token?.let { ... }`), for what its parent sets in it each time (`conditional.ts`). */
  sometimes?: boolean;
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
  annotations: {
    name: string;
    type: Expr;
    optional: boolean;
    /** The field's name in the code, when it is serialized under another one (`@JsonProperty("user_id") userId`). */
    field?: string;
  }[];
  module: ModuleModel;
  /** Annotations of the class itself (JVM: `@FeignClient(url = ...)`). */
  classAnnotations?: Annotation[];
  /** Annotations of fields declared in the class body (JVM: `@Inject lateinit var client: OkHttpClient`). */
  fieldAnnotations?: Map<string, Annotation[]>;
  /** The name a field is read under when its declaration gives one (pydantic `Field(alias="OPENAI_MODEL")`). */
  fieldAliases?: Map<string, string>;
}

export interface ImportRef {
  /** Full dotted path of the imported symbol: `["openai"]`, `["openai", "OpenAI"]`, `["Stripe", "StripeClient"]`. */
  path: string[];
}

export interface ModuleModel {
  /** Absolute path. */
  file: string;
  /** The file's language, when its front end reads several (Kotlin and Java): the language of its calls. */
  language?: Language;
  /** Python: dotted module name from the scanned root (`app.services.billing`); PHP: the namespace; Kotlin: the package. */
  name: string;
  imports: Map<string, ImportRef>;
  /** Every import path, for the SDK coverage (`openai`, `google.genai`, `Stripe.StripeClient`). */
  importPaths: string[][];
  /** Packages imported whole (Kotlin `import com.example.api.*`): their project declarations are names here. */
  wildcards?: string[][];
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
    case "scoped":
      return exprText(e.expr);
    default:
      return e.k === "unknown" ? e.text : e.k;
  }
}

/** The argument a call passes for `p`: by keyword (a PHP named argument has no `$`), else by position. */
export function argFor(call: CallExpr, p: Param): Arg | undefined {
  const name = p.name.replace(/^\$/, "");
  return call.args.find((a) => a.name === name) ?? call.args.filter((a) => !a.name && !a.spread)[p.index];
}

/** What a call gives an extension function as its receiver: the object it is made on, else the caller's own `this`. */
export function receiverArg(call: CallExpr): Expr {
  return call.fn.k === "attr" ? call.fn.obj : { k: "name", name: "this", pos: call.pos };
}

/** The object a call is made on: `client` in `client.newCall(r)`, the extension's receiver for a bare `newCall(r)` in one. */
export function callObject(call: CallExpr): Expr | undefined {
  if (call.fn.k === "attr") return call.fn.obj;
  return call.fn.k === "name" && call.fn.implicit ? { k: "name", name: "this", pos: call.pos } : undefined;
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
