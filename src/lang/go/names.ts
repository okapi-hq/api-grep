import path from "node:path";
import { isInside, readConfigFile } from "../../files.js";
import type { ClassDef, Expr, FunctionDef, ModuleModel, Pos } from "../ir/model.js";
import type { SyntaxNode } from "../tree-sitter.js";
import packages from "./packages.json" with { type: "json" };

/**
 * A Go import path as the engine's dotted segments: `github.com/sashabaranov/go-openai` ->
 * `github_com.sashabaranov.go-openai`. Registry roots are split on `.`, so a dot inside a path element becomes `_`; a
 * module path is then a prefix of the import paths of its packages, as in Go.
 */
export function importSegments(importPath: string): string[] {
  return importPath
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(/\./g, "_"));
}

export const importRoot = (importPath: string): string => importSegments(importPath).join(".");

const NAMES: Record<string, string> = packages.names;

/**
 * The name a package is used under when its import gives none: its declared package name, which the scan cannot read for
 * a library. Known modules are listed in `packages.json`; otherwise the last path element, without a major version
 * (`/v2`, `.v3`) and a `go-` / `-go` affix, as Go modules name their packages.
 */
export function packageName(importPath: string): string {
  for (const [prefix, name] of Object.entries(NAMES)) {
    const rest = importPath.startsWith(prefix) ? importPath.slice(prefix.length) : undefined;
    if (rest === "" || (rest !== undefined && /^\/v\d+$/.test(rest))) return name;
  }
  const parts = importPath.split("/").filter(Boolean);
  let last = parts.at(-1) ?? importPath;
  if (/^v\d+$/.test(last) && parts.length > 1) last = parts.at(-2)!;
  last = last.replace(/\.v\d+$/, "").replace(/^go-/, "").replace(/-go$/, "");
  return last.replace(/[^A-Za-z0-9_]/g, "").toLowerCase();
}

/** A composite literal of a struct of the project, whose fields are given to its class once every file is lowered. */
export interface StructLiteral {
  /** The type as written: a name of the file's package, or `alias.Name` of another package of the project. */
  type: string[];
  fields: { name?: string; value: Expr }[];
  fn: FunctionDef;
}

/** What a file's lowering leaves for `linkGo`: struct literals, and classes it declares (not only methods of). */
export interface GoExtras {
  literals: StructLiteral[];
  declared: Set<ClassDef>;
  /** Field order of the structs declared in the file, for positional literals. */
  order: Map<ClassDef, string[]>;
  /** Import alias -> import path. */
  imports: Map<string, string>;
}

export const EXTRAS = new WeakMap<ModuleModel, GoExtras>();

/** Lowering state: the module, the function whose calls are collected, the method receiver's name and local names. */
export interface GoState {
  mod: ModuleModel;
  fn: FunctionDef;
  extras: GoExtras;
  /** The receiver of the method being lowered (`c` in `func (c *Client) ...`): read as `this`. */
  receiver?: string;
  /** Names declared in the function so far: they shadow import aliases (`url := ...` hides `net/url`). */
  locals: Set<string>;
}

export function posOf(n: SyntaxNode): Pos {
  return { line: n.startPosition.row + 1, col: n.startPosition.column + 1, offset: n.startIndex };
}

/** The import path an identifier names as a package in this scope, unless a local hides it. */
export function packageOf(name: string, st: GoState): string | undefined {
  return st.locals.has(name) ? undefined : st.extras.imports.get(name);
}

const moduleCache = new Map<string, { dir: string; module: string } | null>();

/** The `go.mod` governing a directory (inside the scanned directory): its directory and module path. */
function goModOf(dir: string, rootDir: string): { dir: string; module: string } | undefined {
  const key = `${rootDir}\0${dir}`;
  const cached = moduleCache.get(key);
  if (cached !== undefined) return cached ?? undefined;
  const text = readConfigFile(path.join(dir, "go.mod"), rootDir);
  const declared = text !== undefined ? /^\s*module\s+"?([^\s"]+)"?/m.exec(text)?.[1] : undefined;
  const parent = path.dirname(dir);
  const found = declared ? { dir, module: declared } : dir !== rootDir && isInside(rootDir, parent) && parent !== dir ? goModOf(parent, rootDir) : undefined;
  moduleCache.set(key, found ?? null);
  return found;
}

/**
 * A file's package as a dotted module name: its import path (the module path of the nearest `go.mod` and the directory
 * under it), so the imports of other packages of the project find it; the directory under the scanned one without a
 * `go.mod`. Every file of a directory is one package.
 */
export function goModuleName(file: string, rootDir: string): string {
  const dir = path.dirname(file);
  const mod = goModOf(dir, rootDir);
  const rel = (from: string): string => path.relative(from, dir).split(path.sep).join("/");
  const importPath = mod ? [mod.module, rel(mod.dir)].filter(Boolean).join("/") : rel(rootDir);
  return importRoot(importPath);
}
