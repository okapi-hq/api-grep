import type { ClassDef, Expr, FunctionDef, ModuleModel, Pos } from "../ir/model.js";
import { named as namedNodes, type SyntaxNode } from "../tree-sitter.js";

/** Names declared in a block or a method (parameters, locals, loop and catch variables, resources); blocks nest. */
export interface Scope {
  names: Set<string>;
  parent?: Scope;
}

/** A class and its member names; a nested class also sees the members of the classes around it. */
export interface ClassScope {
  def: ClassDef;
  members: Set<string>;
  /** Classes declared in its body, seen there by their simple name. */
  types: Set<string>;
  outer?: ClassScope;
}

/** Lowering state: the module, the function whose calls and assignments are collected, names in scope. */
export interface JState {
  mod: ModuleModel;
  fn: FunctionDef;
  scope: Scope;
  /** The class whose members a bare name can mean (Java's implicit `this` and static members), and their names. */
  cls?: ClassScope;
  /** The scanned root: `BuildConfig` values come from the Gradle module of the file. */
  rootDir: string;
  /**
   * `StringBuilder` locals of the function and what was appended to them so far, in source order
   * (`sb.append(base); sb.append("/v1"); sb.toString()`).
   */
  builders: Map<string, Expr[]>;
  /** The values `yield` gives in the `switch` expression being lowered. */
  yields?: Expr[];
}

/**
 * Lowering that expressions and statements need from the modules above them: statements and lambdas (set by
 * lower-stmt.ts), class declarations and anonymous class bodies (set by lower-class.ts).
 */
export interface Hooks {
  statement(n: SyntaxNode, st: JState): void;
  /** `x = v`, `x += v`, `this.x = v`: recorded where it assigns; its value is the right side. */
  assignment(n: SyntaxNode, st: JState): Expr;
  /** A `switch` used as a value: any of its results. */
  switchValue(n: SyntaxNode, st: JState): Expr;
  lambda(n: SyntaxNode, st: JState): FunctionDef;
  /** `new Interceptor() { ... }`: the method it stands for when it declares only one. */
  anonymousClass(body: SyntaxNode, st: JState): FunctionDef | undefined;
  /** A class, interface, enum or record declaration; `register` adds it to the module. */
  classDecl(n: SyntaxNode, st: JState, register: boolean): void;
}

const hooks: Partial<Hooks> = {};

export function setHooks(h: Partial<Hooks>): void {
  Object.assign(hooks, h);
}

export function hook<K extends keyof Hooks>(k: K): Hooks[K] {
  const h = hooks[k];
  if (!h) throw new Error(`java lowering hook ${k} is not set`);
  return h;
}

/** Named children but comments, which can sit anywhere (`.baseUrl(url) // why` in a builder chain). */
export const named = (n: SyntaxNode): SyntaxNode[] => namedNodes(n).filter((c) => c.type !== "line_comment" && c.type !== "block_comment");

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
export function inBlock(st: JState): JState {
  return { ...st, scope: { names: new Set(), parent: st.scope } };
}

/** A method or lambda body: its parameters, and the enclosing names when it is a closure (a lambda, an anonymous class). */
export function inFunction(st: JState, fn: FunctionDef, closure: boolean): JState {
  return { ...st, fn, scope: { names: new Set(fn.params.map((p) => p.name)), parent: closure ? st.scope : undefined }, builders: new Map() };
}

/**
 * A bare name where it is read: a local or parameter, else a member of the class (`this.name`) or of a class around it
 * (`Outer.name`), else an imported or package name.
 */
export function nameRef(name: string, pos: Pos, st: JState): Expr {
  if (isLocal(st.scope, name)) return { k: "name", name, pos };
  for (let c = st.cls; c; c = c.outer) {
    if (!c.members.has(name)) continue;
    const obj: Expr = c === st.cls ? { k: "this", pos } : { k: "qname", path: c.def.qname.split("."), pos };
    return { k: "attr", obj, name, pos };
  }
  return { k: "name", name, pos };
}
