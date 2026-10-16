import type { ModuleModel } from "../ir/model.js";
import { EXTRAS, type OpenImport } from "./names.js";

/**
 * After every file is lowered: what Dart imports mean. An import without a prefix makes every name its library exports
 * a name of the file; a library exports its own top-level declarations, its parts' and those of the libraries it
 * `export`s. Each such name of a project library becomes an import of the file (`ApiClient` ->
 * `<pkg>.services.api.ApiClient`), so names resolve without searching every import. A package outside the project is
 * named by its package alone (`package:dio/dio.dart` -> `dio`): its names are the library's, and its prefix
 * (`as http`) reads `http.get` as `http.get`.
 */

interface Exported {
  /** Name -> the module that declares it. */
  names: Map<string, ModuleModel>;
  /** Packages outside the project it re-exports, as wildcard paths. */
  external: string[][];
}

/** A package outside the project is its package name; `dart:` libraries keep theirs (`dart.convert`). */
const externalPath = (path: string[]): string[] => (path[0] === "dart" ? path.slice(0, 2) : path.slice(0, 1));

function declared(mod: ModuleModel): string[] {
  return [...mod.functions.keys(), ...mod.classes.keys(), ...mod.top.assigns.map((a) => a.target)];
}

const visible = (name: string, imp: OpenImport): boolean => (!imp.show || imp.show.includes(name)) && !imp.hide?.includes(name);

class Linker {
  private readonly byName = new Map<string, ModuleModel>();
  private readonly exported = new Map<ModuleModel, Exported>();
  /** Library -> its parts, and part -> its library. */
  private readonly parts = new Map<ModuleModel, ModuleModel[]>();
  private readonly libraryOf = new Map<ModuleModel, ModuleModel>();

  constructor(private readonly mods: ModuleModel[]) {
    for (const m of mods) if (!this.byName.has(m.name)) this.byName.set(m.name, m);
    for (const m of mods) {
      const own = (EXTRAS.get(m)?.parts ?? []).map((p) => this.byName.get(p.join("."))).filter((p): p is ModuleModel => !!p && p !== m);
      this.parts.set(m, own);
      for (const p of own) this.libraryOf.set(p, m);
    }
    // `part of 'lib.dart';` in a part its library does not list the same way
    for (const m of mods) {
      const of = EXTRAS.get(m)?.partOf;
      const lib = of && !this.libraryOf.has(m) ? this.project(of) : undefined;
      if (lib && lib !== m) {
        this.libraryOf.set(m, lib);
        this.parts.get(lib)!.push(m);
      }
    }
  }

  isPart(mod: ModuleModel): boolean {
    return this.libraryOf.has(mod);
  }

  project(path: string[]): ModuleModel | undefined {
    return this.byName.get(path.join("."));
  }

  /** The names a library exports: its own and its parts' declarations, then what it re-exports. */
  exports(mod: ModuleModel, open = new Set<ModuleModel>()): Exported {
    const cached = this.exported.get(mod);
    if (cached) return cached;
    const out: Exported = { names: new Map(), external: [] };
    if (open.has(mod)) return out;
    open.add(mod);
    for (const unit of [mod, ...(this.parts.get(mod) ?? [])]) for (const n of declared(unit)) if (!out.names.has(n)) out.names.set(n, unit);
    for (const exp of EXTRAS.get(mod)?.exports ?? []) {
      const target = this.project(exp.path);
      if (!target) {
        out.external.push(externalPath(exp.path));
        continue;
      }
      const inner = this.exports(target, open);
      for (const [n, at] of inner.names) if (visible(n, exp) && !out.names.has(n)) out.names.set(n, at);
      out.external.push(...inner.external);
    }
    open.delete(mod);
    this.exported.set(mod, out);
    return out;
  }

  /** Adds the names of one library to a file's imports, unless the file declares or imports them already. */
  private openLibrary(mod: ModuleModel, lib: ModuleModel, imp: OpenImport | undefined, own: Set<string>): void {
    const exp = this.exports(lib);
    for (const [n, at] of exp.names) {
      if (own.has(n) || mod.imports.has(n) || (imp && !visible(n, imp))) continue;
      if (at !== mod) mod.imports.set(n, { path: [...at.name.split("."), n] });
    }
    mod.wildcards!.push(...exp.external);
  }

  link(mod: ModuleModel): void {
    const extras = EXTRAS.get(mod);
    // a part reads its library's imports and declarations, and the other parts'
    const lib = this.libraryOf.get(mod) ?? mod;
    const libExtras = EXTRAS.get(lib) ?? extras;
    const own = new Set(declared(mod));
    for (const [n, ref] of mod.imports) {
      if (!this.project(ref.path)) mod.imports.set(n, { path: externalPath(ref.path) });
    }
    // the library is linked first: its imports are final
    if (lib !== mod) for (const [n, ref] of lib.imports) if (!mod.imports.has(n) && !own.has(n)) mod.imports.set(n, ref);
    for (const unit of [lib, ...(this.parts.get(lib) ?? [])]) if (unit !== mod) this.openLibrary(mod, unit, undefined, own);
    for (const imp of libExtras?.open ?? []) {
      const target = this.project(imp.path);
      if (target) this.openLibrary(mod, target, imp, own);
      else mod.wildcards!.push(externalPath(imp.path));
    }
    mod.importPaths = mod.importPaths.map((p) => (this.project(p) ? p : externalPath(p)));
  }
}

export function linkDart(mods: ModuleModel[]): void {
  const linker = new Linker(mods);
  // libraries first: a part copies its library's imports once they are linked
  for (const m of mods) if (!linker.isPart(m)) linker.link(m);
  for (const m of mods) if (linker.isPart(m)) linker.link(m);
}
