import type { ClassDef, Expr, FunctionDef, ModuleModel } from "../ir/model.js";
import { EXTRAS, importRoot, type StructLiteral } from "./names.js";

/**
 * After every file is lowered: the files of one package (one directory) share their types, so a struct declared in one
 * file and given methods in another is one class, and the struct literals of the project give its fields their values
 * (`&Client{baseURL: u}` in a constructor function, `Config{BaseURL: "..."}` in another package).
 */

function addField(cls: ClassDef, name: string, value: Expr, fn: FunctionDef): void {
  cls.fields.set(name, [...(cls.fields.get(name) ?? []), { value, fn }]);
}

/** Moves what a file's stub of a type holds (its methods) into the class that declares the type. */
function merge(into: ClassDef, from: ClassDef): void {
  for (const [name, fn] of from.methods) {
    if (!into.methods.has(name)) into.methods.set(name, fn);
    fn.cls = into;
  }
  for (const [name, values] of from.fields) for (const v of values) addField(into, name, v.value, v.fn);
  for (const [name, type] of from.fieldTypes) if (!into.fieldTypes.has(name)) into.fieldTypes.set(name, type);
  into.bases.push(...from.bases);
  into.annotations.push(...from.annotations);
}

/** One class per type and package: the one a file declares, else the first stub. */
function packageClasses(mods: ModuleModel[]): Map<string, ClassDef> {
  const primary = new Map<string, ClassDef>();
  for (const m of mods) for (const c of EXTRAS.get(m)?.declared ?? []) if (!primary.has(c.name)) primary.set(c.name, c);
  for (const m of mods) for (const c of m.classes.values()) if (!primary.has(c.name)) primary.set(c.name, c);
  for (const m of mods) {
    for (const [name, c] of [...m.classes]) {
      const p = primary.get(name)!;
      if (p === c) continue;
      merge(p, c);
      m.classes.set(name, p);
    }
  }
  return primary;
}

/** The class a struct literal builds: a type of the file's package, or `alias.Name` of another package of the project. */
function literalClass(lit: StructLiteral, mod: ModuleModel, classes: Map<string, Map<string, ClassDef>>): ClassDef | undefined {
  if (lit.type.length === 1) return classes.get(mod.name)?.get(lit.type[0]!);
  const importPath = EXTRAS.get(mod)?.imports.get(lit.type[0]!);
  return importPath ? classes.get(importRoot(importPath))?.get(lit.type[1]!) : undefined;
}

function applyLiteral(lit: StructLiteral, cls: ClassDef): void {
  const order = EXTRAS.get(cls.module)?.order.get(cls) ?? [];
  lit.fields.forEach((f, i) => {
    const name = f.name ?? order[i];
    if (name) addField(cls, name, f.value, lit.fn);
  });
}

export function linkGo(mods: ModuleModel[]): void {
  const byPackage = new Map<string, ModuleModel[]>();
  for (const m of mods) byPackage.set(m.name, [...(byPackage.get(m.name) ?? []), m]);
  const classes = new Map<string, Map<string, ClassDef>>();
  for (const [pkg, ms] of byPackage) classes.set(pkg, packageClasses(ms));
  for (const m of mods) {
    for (const lit of EXTRAS.get(m)?.literals ?? []) {
      const cls = literalClass(lit, m, classes);
      if (cls) applyLiteral(lit, cls);
    }
  }
}
