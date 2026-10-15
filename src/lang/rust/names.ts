import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { isInside, readConfigFile } from "../../files.js";
import type { ClassDef, Expr, FunctionDef, ModuleModel, Pos } from "../ir/model.js";
import type { Parser, SyntaxNode } from "../tree-sitter.js";

/**
 * A crate's modules as dotted names: the crate root (`src/lib.rs`, `src/main.rs`) is the crate's name (`-` as `_`, as
 * the code writes it), `src/llm/client.rs` (or `src/llm/client/mod.rs`) is `<crate>.llm.client`. Paths written from
 * `crate::`, `self::` and `super::` are made absolute while lowering, so the index resolves them like any import.
 */

export const crateIdent = (name: string): string => name.trim().replace(/-/g, "_");

interface Crate {
  dir: string;
  name: string;
}

const crateCache = new Map<string, Crate | null>();

/** The `[lib] name`, else `[package] name`, of a `Cargo.toml`; undefined for a workspace manifest without a package. */
export function crateName(text: string): string | undefined {
  try {
    const toml = parseToml(text) as { package?: { name?: unknown }; lib?: { name?: unknown } };
    const name = typeof toml.lib?.name === "string" ? toml.lib.name : typeof toml.package?.name === "string" ? toml.package.name : undefined;
    return name ? crateIdent(name) : undefined;
  } catch {
    return undefined;
  }
}

/** The crate a directory belongs to: the nearest `Cargo.toml` with a package, inside the scanned directory. */
function crateOf(dir: string, rootDir: string): Crate | undefined {
  const key = `${rootDir}\0${dir}`;
  const cached = crateCache.get(key);
  if (cached !== undefined) return cached ?? undefined;
  const text = readConfigFile(path.join(dir, "Cargo.toml"), rootDir);
  const name = text !== undefined ? crateName(text) : undefined;
  const parent = path.dirname(dir);
  const found = name ? { dir, name } : dir !== rootDir && isInside(rootDir, parent) && parent !== dir ? crateOf(parent, rootDir) : undefined;
  crateCache.set(key, found ?? null);
  return found;
}

const ident = (s: string): string => s.replace(/[^A-Za-z0-9_]/g, "_");

/**
 * A file's module path, as segments: the crate's name, then the directories under `src/` and the file's stem
 * (`mod.rs`, `lib.rs` and `main.rs` name their directory). A binary of `src/bin/` is a crate root of its own, named
 * after the file. Without a `Cargo.toml`, the path under the scanned directory.
 */
export function rustModulePath(file: string, rootDir: string): { module: string[]; root: string[] } {
  const crate = crateOf(path.dirname(file), rootDir);
  const base = crate ? crate.dir : rootDir;
  let rel = path.relative(base, file).split(path.sep);
  const inSrc = rel[0] === "src";
  if (inSrc) rel = rel.slice(1);
  const stem = rel.at(-1)!.replace(/\.rs$/, "");
  const dirs = rel.slice(0, -1).map(ident);
  const crateSeg = crate ? [crate.name] : ["crate"];
  // `src/bin/x.rs` and `examples/x.rs` are crates of their own: `crate::` there is the file itself
  if ((inSrc && dirs[0] === "bin") || (!inSrc && dirs[0] === "examples")) {
    const binRoot = [...crateSeg, dirs[0], ...(dirs.length > 1 ? [dirs[1]!] : [ident(stem)])];
    return { module: dirs.length > 1 && stem !== "main" ? [...binRoot, ...dirs.slice(2), ident(stem)] : binRoot, root: binRoot };
  }
  const own = stem === "mod" || ((stem === "lib" || stem === "main") && dirs.length === 0) ? dirs : [...dirs, ident(stem)];
  return { module: [...crateSeg, ...own], root: crateSeg };
}

/** A struct literal of a project type (`Self { url }`, `Config { .. }`), whose fields go to its class once every file is lowered. */
export interface StructLiteral {
  /** The type as an expression of the file (a name, a path). */
  type: Expr;
  fields: { name: string; value: Expr }[];
  fn: FunctionDef;
}

/** What a file's lowering leaves for `linkRust`: struct literals, the impl blocks of types and the structs it declares. */
export interface RustExtras {
  literals: StructLiteral[];
  /** Classes the file declares with `struct`; the others are stubs holding the methods of an `impl`. */
  declared: Set<ClassDef>;
  /** `impl` blocks of a type written as a path (`impl crate::api::Client`): the class stub and the path. */
  impls: { cls: ClassDef; type: Expr }[];
  /** Child modules declared under `#[cfg(test)]` (`mod tests;`): their files are test code. */
  testMods: Set<string>;
}

export const EXTRAS = new WeakMap<ModuleModel, RustExtras>();

/** Per-file facts the lowering reads: module paths, the names a path can start with, and a parser for macro arguments. */
export interface RustFile {
  module: string[];
  root: string[];
  /** `use` aliases -> absolute paths. */
  uses: Map<string, string[]>;
  /** Child modules declared here (`mod config;`, `mod inner { ... }`). */
  mods: Set<string>;
  /** Items declared in the file: types, functions, constants (a path starting with one is a member of it). */
  items: Set<string>;
  /** Lazily made: parses the arguments of a macro (`format!`, `json!` values), which tree-sitter leaves as tokens. */
  parser?: Parser;
  parserFor: () => Parser | undefined;
}

/** Lowering state: the module, the function whose calls are collected, the type of the `impl` around it, local names. */
export interface RustState {
  mod: ModuleModel;
  fn: FunctionDef;
  file: RustFile;
  extras: RustExtras;
  /** The type `Self` names in an `impl` block, as an expression of the file. */
  selfType?: Expr;
  /** The class an inline module (`mod inner { ... }`) is lowered as, while its items are. */
  inline?: ClassDef;
  locals: Set<string>;
  /** Variables holding a parsed URL (`let u = Url::parse(base)?`): `u.join(p)` resolves a reference against it. */
  urls: Set<string>;
}

/**
 * Positions of a macro's arguments, which are parsed apart: the offset, line and column of the snippet's start in the
 * file. Set while they are lowered (lowering is synchronous), zero otherwise.
 */
export const SHIFT = { active: false, offset: 0, row: 0, col: 0, prefix: 0 };

export function posOf(n: SyntaxNode): Pos {
  const { row, column } = n.startPosition;
  if (!SHIFT.active) return { line: row + 1, col: column + 1, offset: n.startIndex };
  const col = row === 0 ? SHIFT.col + column - SHIFT.prefix : column;
  return { line: SHIFT.row + row + 1, col: col + 1, offset: SHIFT.offset + n.startIndex - SHIFT.prefix };
}
