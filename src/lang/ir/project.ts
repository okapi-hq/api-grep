import type { IrLanguage } from "./language.js";
import type { Assign, ClassDef, Expr, FunctionDef, ModuleModel, Param } from "./model.js";

export type Binding =
  | { kind: "param"; fn: FunctionDef; param: Param }
  | { kind: "value"; assign: Assign; fn: FunctionDef }
  | { kind: "function"; fn: FunctionDef }
  | { kind: "class"; cls: ClassDef }
  | { kind: "module"; mod: ModuleModel }
  | { kind: "external"; path: string[] }
  | { kind: "none" };

export type Member = { kind: "module"; mod: ModuleModel } | { kind: "class"; cls: ClassDef } | { kind: "function"; fn: FunctionDef };

/** Every file of one language in the scan, indexed for cross-file lookups: modules, classes and functions by name. */
export class ProjectIndex {
  private readonly modules = new Map<string, ModuleModel>();
  /** Dotted suffixes of module names (`mypkg.client` for `src.mypkg.client`): imports of a `src/` layout. */
  private readonly suffixes = new Map<string, ModuleModel[]>();
  private readonly classes = new Map<string, ClassDef>();
  private readonly functions = new Map<string, FunctionDef>();
  /** Module-level constants every file sees (PHP `define()` / `const`), when the language shares them. */
  private readonly globals = new Map<string, { assign: Assign; fn: FunctionDef }>();
  /** Functions by their short name (PHP: a namespaced helper called from its own namespace), when globals are shared. */
  private readonly shortFunctions = new Map<string, FunctionDef>();
  /** Import roots of known SDKs and clients: never resolved to a project module (`services/stripe.py` is not `stripe`). */
  private readonly external: Set<string>;

  constructor(
    readonly lang: IrLanguage,
    private readonly mods: ModuleModel[],
  ) {
    this.external = new Set([...lang.registry.flatMap((r) => r.imports), ...lang.clients.flatMap((c) => c.imports)].map((i) => i.split(".")[0]!));
    for (const m of mods) this.add(m);
  }

  private add(m: ModuleModel): void {
    if (m.name && !this.modules.has(m.name)) this.modules.set(m.name, m);
    const segs = m.name.split(".");
    for (let i = 1; i < segs.length; i++) {
      const key = segs.slice(i).join(".");
      this.suffixes.set(key, [...(this.suffixes.get(key) ?? []), m]);
    }
    for (const c of m.classes.values()) if (!this.classes.has(c.qname)) this.classes.set(c.qname, c);
    for (const f of m.functions.values()) {
      const q = m.name ? `${m.name}.${f.name}` : f.name;
      if (!this.functions.has(q)) this.functions.set(q, f);
    }
    if (!this.lang.sharedGlobals) return;
    for (const f of m.functions.values()) if (!this.shortFunctions.has(f.name)) this.shortFunctions.set(f.name, f);
    for (const a of m.top.assigns) if (!a.target.startsWith("$") && !a.target.includes(".") && !this.globals.has(a.target)) this.globals.set(a.target, { assign: a, fn: m.top });
  }

  /**
   * A module by dotted name, as an import in `from` sees it: the exact name, a sibling of the importing file (a script's
   * directory is on `sys.path`), or the end of a longer name (`mypkg.client` in `src/mypkg/client.py`). A module never
   * imports itself, and a one-segment name is never matched by suffix (`ollama` is not `mem0/llms/ollama.py`).
   */
  private moduleNamed(name: string, from: ModuleModel | undefined): ModuleModel | undefined {
    const ok = (m: ModuleModel | undefined): ModuleModel | undefined => (m && m !== from ? m : undefined);
    const exact = ok(this.modules.get(name));
    if (exact) return exact;
    const pkg = from?.name.split(".").slice(0, -1) ?? [];
    const sibling = pkg.length > 0 ? ok(this.modules.get([...pkg, name].join("."))) : undefined;
    if (sibling) return sibling;
    if (!name.includes(".")) return undefined;
    return (this.suffixes.get(name) ?? []).find((m) => m !== from);
  }

  /** The project symbol a dotted path names, and the members after it; undefined for a package outside the project. */
  resolvePath(path: string[], from?: ModuleModel): { member: Member; rest: string[] } | undefined {
    for (let n = path.length; n > 0; n--) {
      const key = path.slice(0, n).join(".");
      const cls = this.classes.get(key);
      if (cls && cls.module !== from) return { member: { kind: "class", cls }, rest: path.slice(n) };
      const fn = this.functions.get(key);
      if (fn && fn.module !== from) return { member: { kind: "function", fn }, rest: path.slice(n) };
      if (n === 1 && this.external.has(path[0]!) && !this.modules.has(key)) return undefined;
      const mod = this.moduleNamed(key, from);
      if (mod) return { member: { kind: "module", mod }, rest: path.slice(n) };
    }
    return undefined;
  }

  /** Every module of the language. */
  all(): ModuleModel[] {
    return this.mods;
  }

  /** A global function or constant defined in any file (PHP `define()` / helpers): the last resort of a lookup. */
  global(name: string): Binding {
    if (!this.lang.sharedGlobals) return { kind: "none" };
    const fn = this.functions.get(name) ?? this.shortFunctions.get(name);
    if (fn) return { kind: "function", fn };
    const g = this.globals.get(name);
    return g ? { kind: "value", assign: g.assign, fn: g.fn } : { kind: "none" };
  }
}

/** The assignment of `target` in effect at `at`: the last one before it, else the first one (a loop, a branch). */
export function lastAssign(assigns: Assign[], target: string, at: number | undefined): Assign | undefined {
  let before: Assign | undefined;
  let first: Assign | undefined;
  for (const a of assigns) {
    if (a.target !== target) continue;
    first ??= a;
    if (at === undefined || a.offset < at) before = a;
  }
  return before ?? first;
}

const MAX_REEXPORTS = 6;

/** What a module-level name is: a variable, function, class or import (followed through re-exports). */
export function moduleMember(mod: ModuleModel, name: string, idx: ProjectIndex, depth = 0): Binding {
  const a = lastAssign(mod.top.assigns, name, undefined);
  if (a) return { kind: "value", assign: a, fn: mod.top };
  const fn = mod.functions.get(name);
  if (fn) return { kind: "function", fn };
  const cls = mod.classes.get(name);
  if (cls) return { kind: "class", cls };
  const imp = mod.imports.get(name);
  if (imp) return bindingOfPath(imp.path, idx, mod, depth + 1);
  return { kind: "none" };
}

/** A dotted path (an import, a qualified class name): a project symbol when the project defines it, else external. */
export function bindingOfPath(path: string[], idx: ProjectIndex, from?: ModuleModel, depth = 0): Binding {
  const hit = depth > MAX_REEXPORTS ? undefined : idx.resolvePath(path, from);
  if (!hit) return { kind: "external", path };
  if (hit.rest.length === 0) return memberBinding(hit.member);
  if (hit.member.kind === "module" && hit.rest.length === 1) return moduleMember(hit.member.mod, hit.rest[0]!, idx, depth);
  return { kind: "external", path };
}

export function memberBinding(m: Member): Binding {
  return m.kind === "module" ? { kind: "module", mod: m.mod } : m.kind === "class" ? { kind: "class", cls: m.cls } : { kind: "function", fn: m.fn };
}

function visibleInParent(fn: FunctionDef, name: string): boolean {
  return !!fn.parent && !!fn.inherits && (fn.inherits.includes("*") || fn.inherits.includes(name));
}

/** Resolves a name where it is used: locals, parameters, enclosing functions, then the module and the project. */
export function lookup(name: string, fn: FunctionDef, at: number | undefined, idx: ProjectIndex): Binding {
  const local = lastAssign(fn.assigns, name, at);
  const param = fn.params.find((p) => p.name === name);
  // a parameter reassigned only later (`$url = $response->getHeader(...)` in a loop) is still the parameter here
  if (param && (!local || (at !== undefined && local.offset >= at))) return { kind: "param", fn, param };
  if (local) return { kind: "value", assign: local, fn };
  if (visibleInParent(fn, name)) return lookup(name, fn.parent!, fn.pos.offset, idx);
  const mod = fn.module;
  if (fn === mod.top || idx.lang.moduleVarsVisible || !name.startsWith("$")) {
    const b = moduleMember(mod, name, idx);
    if (b.kind !== "none") return b;
  }
  return name.startsWith("$") ? { kind: "none" } : idx.global(name);
}

/** The field `name` of a class or its project base classes: its values, with the method each is assigned in. */
export function classField(cls: ClassDef, name: string, idx: ProjectIndex, seen = new Set<ClassDef>()): { value: Expr; fn: FunctionDef }[] {
  if (seen.has(cls)) return [];
  seen.add(cls);
  const own = cls.fields.get(name);
  if (own && own.length > 0) return own;
  for (const b of projectBases(cls, idx)) {
    const hit = classField(b, name, idx, seen);
    if (hit.length > 0) return hit;
  }
  return [];
}

export function classMethod(cls: ClassDef, name: string, idx: ProjectIndex, seen = new Set<ClassDef>()): FunctionDef | undefined {
  if (seen.has(cls)) return undefined;
  seen.add(cls);
  const own = cls.methods.get(name);
  if (own) return own;
  for (const b of projectBases(cls, idx)) {
    const hit = classMethod(b, name, idx, seen);
    if (hit) return hit;
  }
  return undefined;
}

export function classFieldType(cls: ClassDef, name: string, idx: ProjectIndex, seen = new Set<ClassDef>()): Expr | undefined {
  if (seen.has(cls)) return undefined;
  seen.add(cls);
  const own = cls.fieldTypes.get(name);
  if (own) return own;
  for (const b of projectBases(cls, idx)) {
    const hit = classFieldType(b, name, idx, seen);
    if (hit) return hit;
  }
  return undefined;
}

/** Base classes defined in the project. */
export function projectBases(cls: ClassDef, idx: ProjectIndex): ClassDef[] {
  const out: ClassDef[] = [];
  for (const b of cls.bases) {
    const bind = baseBinding(b, cls, idx);
    if (bind.kind === "class") out.push(bind.cls);
  }
  return out;
}

/** What a base class expression names, looked up in the class's module. */
export function baseBinding(b: Expr, cls: ClassDef, idx: ProjectIndex): Binding {
  if (b.k === "name") return lookup(b.name, cls.module.top, undefined, idx);
  if (b.k === "qname") return bindingOfPath(b.path, idx);
  if (b.k === "attr" && b.obj.k === "name") {
    const head = lookup(b.obj.name, cls.module.top, undefined, idx);
    if (head.kind === "module") return moduleMember(head.mod, b.name, idx);
    if (head.kind === "external") return { kind: "external", path: [...head.path, b.name] };
  }
  return { kind: "none" };
}
