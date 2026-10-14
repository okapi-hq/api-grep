import type { ClassDef, Expr, FunctionDef, ModuleModel, Pos } from "../ir/model.js";
import type { SyntaxNode } from "../tree-sitter.js";

/** Names declared in a block or a function (parameters, `val` / `var`, loop variables); blocks nest. */
export interface Scope {
  names: Set<string>;
  parent?: Scope;
}

/** Lowering state: the module, the function whose calls and assignments are collected, names in scope. */
export interface KtState {
  mod: ModuleModel;
  fn: FunctionDef;
  scope: Scope;
  /** The class whose members a bare name can mean (Kotlin's implicit `this`), and their names. */
  cls?: { def: ClassDef; members: Set<string> };
  /** The scanned root: `BuildConfig` values come from the Gradle module of the file. */
  rootDir: string;
  /**
   * Inside an extension function (`fun S3Client.delete(...)`, #86): its name (`this@delete`), and whether `this` and
   * bare names mean its receiver here (not in a lambda with a receiver of its own, `apply { }`, a DSL builder).
   */
  receiver?: { label: string; implicit: boolean };
}

/** What a lambda lowers to: its function, and the values of its expression statements in order (`buildString`). */
export interface Lambda {
  fn: FunctionDef;
  values: Expr[];
}

/**
 * Lowering that expressions and statements need from the modules above them: lambdas, branches and anonymous objects
 * (set by lower-stmt.ts), class declarations (set by lower-class.ts).
 */
export interface Hooks {
  lambda(n: SyntaxNode, st: KtState): Lambda;
  /** A statement or block (an `if` / `when` branch, a `try` body), and the value of its last expression. */
  statement(n: SyntaxNode, st: KtState): Expr;
  /** An anonymous object; the function it stands for when it has only one. */
  objectLiteral(n: SyntaxNode, st: KtState): FunctionDef | undefined;
  /** A class, interface or `object` declaration; `top` registers it in the module. */
  classDecl(n: SyntaxNode, st: KtState, top: boolean): void;
}

const hooks: Partial<Hooks> = {};

export function setHooks(h: Partial<Hooks>): void {
  Object.assign(hooks, h);
}

export function hook<K extends keyof Hooks>(k: K): Hooks[K] {
  const h = hooks[k];
  if (!h) throw new Error(`kotlin lowering hook ${k} is not set`);
  return h;
}

export function posOf(n: SyntaxNode): Pos {
  return { line: n.startPosition.row + 1, col: n.startPosition.column + 1, offset: n.startIndex };
}

export function newFunction(name: string, mod: ModuleModel, n: SyntaxNode, extra: Partial<FunctionDef> = {}): FunctionDef {
  return { name, params: [], assigns: [], returns: [], calls: [], module: mod, pos: posOf(n), ...extra };
}

export function isLocal(scope: Scope | undefined, name: string): boolean {
  for (let s = scope; s; s = s.parent) if (s.names.has(name)) return true;
  return false;
}

/** A nested block: its declarations end with it. */
export function inBlock(st: KtState): KtState {
  return { ...st, scope: { names: new Set(), parent: st.scope } };
}

/** A function body: its parameters, and the enclosing names when it is a closure (a lambda, a local function). */
export function inFunction(st: KtState, fn: FunctionDef, closure: boolean): KtState {
  return { ...st, fn, scope: { names: new Set(fn.params.map((p) => p.name)), parent: closure ? st.scope : undefined } };
}

/**
 * A bare name where it is read: a local or parameter, else a member of the class (`this.name`), else a top-level name,
 * which in an extension function may be a member of its receiver (`implicit`, resolved by the engine).
 */
export function nameRef(name: string, pos: Pos, st: KtState): Expr {
  const local = isLocal(st.scope, name);
  if (!local && st.cls?.members.has(name)) return { k: "attr", obj: { k: "this", pos }, name, pos };
  return { k: "name", name, pos, ...(!local && st.receiver?.implicit && /^[a-z]/.test(name) ? { implicit: true } : {}) };
}

/** `this`, `this@label`: the extension function's receiver where it is the one meant, else the class's `this`. */
export function thisRef(label: string | undefined, pos: Pos, st: KtState): Expr {
  const r = st.receiver;
  return r && (label ? label === r.label : r.implicit) ? { k: "name", name: "this", pos } : { k: "this", pos };
}
