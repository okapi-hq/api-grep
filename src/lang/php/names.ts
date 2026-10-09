import type { Expr, FunctionDef, ModuleModel, Pos } from "../ir/model.js";
import { named, type SyntaxNode } from "../tree-sitter.js";

/** Name resolution state of a PHP file: the namespace in effect and its `use` imports. */
export interface PhpNames {
  namespace: string[];
  classes: Map<string, string[]>;
  functions: Map<string, string[]>;
  consts: Map<string, string[]>;
}

/** Lowering state: the module, the function whose calls are collected, the class being lowered, and names. */
export interface PhpState {
  mod: ModuleModel;
  fn: FunctionDef;
  names: PhpNames;
  /** Qualified name of the enclosing class (`self`, `static`) and of its parent (`parent`). */
  cls?: { path: string[]; parent?: string[] };
}

export function posOf(n: SyntaxNode): Pos {
  return { line: n.startPosition.row + 1, col: n.startPosition.column + 1, offset: n.startIndex };
}

export function newNames(): PhpNames {
  return { namespace: [], classes: new Map(), functions: new Map(), consts: new Map() };
}

const key = (name: string): string => name.toLowerCase();

/** `\A\B\C` -> `{ absolute, parts }`. */
function split(text: string): { absolute: boolean; parts: string[] } {
  const t = text.trim();
  return { absolute: t.startsWith("\\"), parts: t.replace(/^\\/, "").split("\\").filter(Boolean) };
}

/** A class name as written (`Client`, `Http\Client`, `\GuzzleHttp\Client`, `self`) to its fully qualified path. */
export function classPath(text: string, st: PhpState): string[] {
  const lower = text.toLowerCase();
  if ((lower === "self" || lower === "static") && st.cls) return st.cls.path;
  if (lower === "parent" && st.cls?.parent) return st.cls.parent;
  const { absolute, parts } = split(text);
  const alias = absolute ? undefined : st.names.classes.get(key(parts[0] ?? ""));
  const path = absolute || parts.length === 0 ? parts : alias ? [...alias, ...parts.slice(1)] : [...st.names.namespace, ...parts];
  // `new \GuzzleHttp\Client(...)` and `OpenAI::client()` in the global namespace use a package as much as a `use` does
  if (!alias && path.length > 0) st.mod.importPaths.push(path);
  return path;
}

/** A function call name: imported with `use function`, qualified, or a plain (global or same-namespace) name. */
export function functionRef(text: string, st: PhpState, pos: Pos): Expr {
  const { absolute, parts } = split(text);
  if (parts.length === 1 && !absolute) {
    const alias = st.names.functions.get(key(parts[0]!));
    return alias ? { k: "qname", path: alias, pos } : { k: "name", name: parts[0]!, pos };
  }
  if (absolute) st.mod.importPaths.push(parts);
  return { k: "qname", path: absolute ? parts : classPath(text, st), pos };
}

/** A constant name (`BASE`, `App\BASE`): `use const` aliases resolve, plain names stay global. */
export function constRef(text: string, st: PhpState, pos: Pos): Expr {
  const { parts } = split(text);
  const alias = parts.length === 1 ? st.names.consts.get(parts[0]!) : undefined;
  if (alias) return { k: "attr", obj: { k: "qname", path: alias.slice(0, -1), pos }, name: alias[alias.length - 1]!, pos };
  return parts.length === 1 ? { k: "name", name: parts[0]!, pos } : { k: "qname", path: parts, pos };
}

/** `use A\B;`, `use A\B as C;`, `use function A\f;`, `use const A\X;`, `use A\{B, C as D};`. */
const useKind = (n: SyntaxNode): string | undefined => n.children.find((c) => c && !c.isNamed && (c.type === "function" || c.type === "const"))?.type;

export function lowerUse(n: SyntaxNode, st: PhpState): string[][] {
  const declKind = useKind(n);
  const groupPrefix = named(n).find((c) => c.type === "namespace_name");
  const prefix = groupPrefix ? split(groupPrefix.text).parts : [];
  const clauses = named(n).flatMap((c) => (c.type === "namespace_use_group" ? named(c) : [c])).filter((c) => c.type === "namespace_use_clause");
  const paths: string[][] = [];
  for (const clause of clauses) {
    const kind = useKind(clause) ?? declKind;
    const target = kind === "function" ? st.names.functions : kind === "const" ? st.names.consts : st.names.classes;
    const nameNode = named(clause).find((c) => c.type === "qualified_name" || c.type === "name");
    if (!nameNode) continue;
    const path = [...prefix, ...split(nameNode.text).parts];
    const alias = clause.childForFieldName("alias")?.text ?? path[path.length - 1]!;
    target.set(kind === "const" ? alias : key(alias), path);
    paths.push(path);
  }
  return paths;
}
