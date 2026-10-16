import path from "node:path";
import { isInside, readConfigFile } from "../../files.js";
import type { ClassDef, Expr, FunctionDef, ModuleModel, Pos } from "../ir/model.js";
import type { SyntaxNode } from "../tree-sitter.js";

/**
 * A Dart package's libraries as dotted module names: the package's name (`name:` of the nearest `pubspec.yaml`), then
 * the path under `lib/` (`lib/services/api.dart` is `<name>.services.api`), which is how `package:<name>/services/api.dart`
 * names it. A file outside `lib/` (`bin/`, `tool/`) keeps its directory, marked so no `package:` import can name it.
 * Relative imports are resolved to the file they name, then named the same way.
 */

interface Package {
  dir: string;
  name: string;
}

const packageCache = new Map<string, Package | null>();

/** The `name:` of a `pubspec.yaml` (a top-level key). */
export function pubspecName(text: string): string | undefined {
  const m = /^name:\s*["']?([A-Za-z_][\w]*)["']?\s*(?:#.*)?$/m.exec(text);
  return m?.[1];
}

/** The package a directory belongs to: the nearest `pubspec.yaml` with a name, inside the scanned directory. */
function packageOf(dir: string, rootDir: string): Package | undefined {
  const key = `${rootDir}\0${dir}`;
  const cached = packageCache.get(key);
  if (cached !== undefined) return cached ?? undefined;
  const text = readConfigFile(path.join(dir, "pubspec.yaml"), rootDir);
  const name = text !== undefined ? pubspecName(text) : undefined;
  const parent = path.dirname(dir);
  const found = name ? { dir, name } : dir !== rootDir && isInside(rootDir, parent) && parent !== dir ? packageOf(parent, rootDir) : undefined;
  packageCache.set(key, found ?? null);
  return found;
}

/** A path segment as a module name segment: no dots, which separate segments. */
const segment = (s: string): string => s.replace(/\.dart$/, "").replace(/[^\w$@-]/g, "_");

/** A file's module name, as segments. */
export function dartModulePath(file: string, rootDir: string): string[] {
  const pkg = packageOf(path.dirname(file), rootDir);
  const rel = path.relative(pkg ? pkg.dir : rootDir, file).split(path.sep).map(segment);
  if (!pkg) return ["@root", ...rel];
  if (rel[0] === "lib") return [pkg.name, ...rel.slice(1)];
  return [pkg.name, `@${rel[0]}`, ...rel.slice(1)];
}

/**
 * What an import, export or part URI names, as a dotted path: `dart:convert` -> `dart.convert`, `package:dio/dio.dart`
 * -> `dio.dio` (a project library when the project has it, else the package `dio`: `link.ts` decides), a relative URI
 * -> the module of the file it names. Undefined for a URI the scan cannot follow (a file outside the scanned directory).
 */
export function importTarget(uri: string, file: string, rootDir: string): string[] | undefined {
  if (uri.startsWith("dart:")) return ["dart", segment(uri.slice(5))];
  const pkg = /^package:([^/]+)\/(.+)$/.exec(uri);
  if (pkg) return [pkg[1]!, ...pkg[2]!.split("/").map(segment)];
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return undefined;
  const target = path.resolve(path.dirname(file), uri);
  return isInside(rootDir, target) ? dartModulePath(target, rootDir) : undefined;
}

/** Names declared in a block or a function (parameters, locals, loop variables); blocks nest. */
export interface Scope {
  names: Set<string>;
  parent?: Scope;
}

/** An import without a prefix: every name its library exports is a name of the file (`link.ts` lists them). */
export interface OpenImport {
  path: string[];
  show?: string[];
  hide?: string[];
}

/** What a file's lowering leaves for `linkDart`: its imports without a prefix, its exports and its parts. */
export interface DartExtras {
  open: OpenImport[];
  exports: OpenImport[];
  /** `part 'x.dart';`: the files whose declarations are the library's own. */
  parts: string[][];
  /** `part of 'lib.dart';`: the library the file belongs to. */
  partOf?: string[];
}

export const EXTRAS = new WeakMap<ModuleModel, DartExtras>();

/** A member set deeper than an attribute of a local (`_dio.options.baseUrl = u`, `dio.options.headers['k'] = v`). */
export interface DeepSet {
  target: Expr;
  value: Expr;
  offset: number;
}

/** The deep member sets of each function, which Dio's defaults are read from (`dio.ts`). */
export const DEEP_SETS = new WeakMap<FunctionDef, DeepSet[]>();

/** Lowering state: the module, the function whose calls are collected, names in scope, the class around them. */
export interface DartState {
  mod: ModuleModel;
  fn: FunctionDef;
  scope: Scope;
  /** The class whose members a bare name can mean (Dart's implicit `this`), and their names. */
  cls?: { def: ClassDef; members: Set<string> };
  rootDir: string;
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
export function inBlock(st: DartState): DartState {
  return { ...st, scope: { names: new Set(), parent: st.scope } };
}

/** A bare name where it is read: a local or parameter, else a member of the class (`this.name`), else a top-level name. */
export function nameRef(name: string, pos: Pos, st: DartState): Expr {
  if (!isLocal(st.scope, name) && st.cls?.members.has(name)) return { k: "attr", obj: { k: "this", pos }, name, pos };
  return { k: "name", name, pos };
}

export function addField(cls: ClassDef, name: string, value: Expr, fn: FunctionDef): void {
  cls.fields.set(name, [...(cls.fields.get(name) ?? []), { value, fn }]);
}
