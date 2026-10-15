import type { ClassDef, Expr, FunctionDef, ModuleModel } from "../ir/model.js";
import { dottedPath } from "../ir/model.js";
import { EXTRAS, type StructLiteral } from "./names.js";

/**
 * After every file is lowered: an `impl` block may be written in another module than its type's `struct` (`impl
 * crate::api::Client`, or a type a `use` names), so its methods and constants move to the declared class; and the
 * struct literals of the project (`Self { base_url: u }` in a constructor, `Config { .. }` elsewhere) give the class's
 * fields their values.
 */

function addField(cls: ClassDef, name: string, value: Expr, fn: FunctionDef): void {
  cls.fields.set(name, [...(cls.fields.get(name) ?? []), { value, fn }]);
}

function merge(into: ClassDef, from: ClassDef): void {
  for (const [name, fn] of from.methods) {
    if (!into.methods.has(name)) into.methods.set(name, fn);
    fn.cls = into;
  }
  for (const [name, values] of from.fields) for (const v of values) addField(into, name, v.value, v.fn);
  for (const [name, type] of from.fieldTypes) if (!into.fieldTypes.has(name)) into.fieldTypes.set(name, type);
}

/** Declared classes by qualified name (`<crate>.api.Client`). */
function declaredClasses(mods: ModuleModel[]): Map<string, ClassDef> {
  const out = new Map<string, ClassDef>();
  for (const m of mods) for (const c of EXTRAS.get(m)?.declared ?? []) if (!out.has(c.qname)) out.set(c.qname, c);
  return out;
}

/** The class a type expression of a module names: its own declared struct, an imported one, a path to one. */
function classOf(type: Expr, mod: ModuleModel, declared: Map<string, ClassDef>): ClassDef | undefined {
  const path = dottedPath(type);
  if (!path) return undefined;
  if (path.length === 1) {
    const own = mod.classes.get(path[0]!);
    if (own && EXTRAS.get(mod)?.declared.has(own)) return own;
    const imported = mod.imports.get(path[0]!)?.path;
    return imported ? declared.get(imported.join(".")) : undefined;
  }
  const head = mod.imports.get(path[0]!)?.path;
  return declared.get([...(head ?? [path[0]!]), ...path.slice(1)].join("."));
}

/** Moves the methods of an `impl` of a type declared elsewhere into the declared class. */
function linkImpls(mods: ModuleModel[], declared: Map<string, ClassDef>): void {
  for (const m of mods) {
    const extras = EXTRAS.get(m);
    for (const c of [...m.classes.values()]) {
      if (extras?.declared.has(c)) continue;
      const written = extras?.impls.find((i) => i.cls === c)?.type ?? { k: "name", name: c.name, pos: c.module.top.pos };
      const target = classOf(written, m, declared);
      if (!target || target === c) continue;
      merge(target, c);
      m.classes.set(c.name, target);
    }
  }
}

function applyLiteral(lit: StructLiteral, cls: ClassDef): void {
  for (const f of lit.fields) addField(cls, f.name, f.value, lit.fn);
}

/** The files of modules declared under `#[cfg(test)]` (`#[cfg(test)] mod tests;`), and their submodules: no call is theirs. */
function dropTestModules(mods: ModuleModel[]): void {
  const tests = mods.flatMap((m) => [...(EXTRAS.get(m)?.testMods ?? [])].map((t) => `${m.name}.${t}`));
  if (tests.length === 0) return;
  for (const m of mods) if (tests.some((t) => m.name === t || m.name.startsWith(`${t}.`))) for (const fn of m.allFunctions) fn.calls = [];
}

export function linkRust(mods: ModuleModel[]): void {
  dropTestModules(mods);
  const declared = declaredClasses(mods);
  linkImpls(mods, declared);
  for (const m of mods) {
    for (const lit of EXTRAS.get(m)?.literals ?? []) {
      const cls = classOf(lit.type, m, declared) ?? (lit.type.k === "name" ? m.classes.get(lit.type.name) : undefined);
      if (cls) applyLiteral(lit, cls);
    }
  }
}
