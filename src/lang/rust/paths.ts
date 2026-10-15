import type { Expr } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { posOf, type RustFile, type RustState } from "./names.js";

/**
 * Paths (`reqwest::Client::new`, `crate::config::BASE_URL`, `Self::BASE`): `crate`, `self` and `super` are made
 * absolute, a `use` alias is expanded, a child module (`mod config;`) is under the file's module; a path starting with
 * a name the file declares (a type, a function) or an unknown type stays a name the index looks up. Any other first
 * segment is an external crate (`reqwest`, `std`), which needs no `use` in Rust 2018.
 */

const PATH_NODES = new Set(["scoped_identifier", "scoped_type_identifier", "scoped_use_list"]);

/** The segments a path node writes: `a::b::c` -> `[a, b, c]`; generic arguments dropped (`Vec::<u8>::new`). */
export function segmentsOf(n: SyntaxNode | undefined): string[] | undefined {
  if (!n) return [];
  switch (n.type) {
    case "identifier":
    case "type_identifier":
    case "field_identifier":
    case "primitive_type":
    case "crate":
    case "self":
    case "super":
      return [n.text];
    case "generic_type":
    case "generic_type_with_turbofish":
      return segmentsOf(field(n, "type"));
    case "metavariable":
      return undefined;
    default: {
      if (!PATH_NODES.has(n.type)) return undefined;
      const head = segmentsOf(field(n, "path"));
      const name = field(n, "name");
      if (!head) return undefined;
      return name ? [...head, name.text] : head;
    }
  }
}

/** The module path `super` (repeated) and `self` lead to, and the rest. */
function relative(segs: string[], file: RustFile): string[] | undefined {
  if (segs[0] === "crate") return [...file.root, ...segs.slice(1)];
  if (segs[0] === "self") return [...file.module, ...segs.slice(1)];
  let up = 0;
  while (segs[up] === "super") up++;
  if (up === 0) return undefined;
  return [...file.module.slice(0, Math.max(file.root.length, file.module.length - up)), ...segs.slice(up)];
}

export type Resolved = { kind: "abs"; path: string[] } | { kind: "local"; segs: string[] } | { kind: "self"; rest: string[] };

/** What a path's first segment is, in a file (`locals` are the function's variables, which no path starts with). */
export function resolveSegments(segs: string[], file: RustFile, locals?: Set<string>): Resolved {
  const rel = relative(segs, file);
  if (rel) return { kind: "abs", path: rel };
  const [head, ...rest] = segs;
  if (head === "Self") return { kind: "self", rest };
  if (locals?.has(head!) && segs.length === 1) return { kind: "local", segs };
  const used = file.uses.get(head!);
  if (used) return { kind: "abs", path: [...used, ...rest] };
  if (file.mods.has(head!)) return { kind: "abs", path: [...file.module, ...segs] };
  if (file.items.has(head!) || !/^[a-z_]/.test(head!) || segs.length === 1) return { kind: "local", segs };
  return { kind: "abs", path: segs };
}

/** `a.b.c` on a head expression. */
function members(head: Expr, rest: string[], n: SyntaxNode): Expr {
  return rest.reduce<Expr>((obj, name) => ({ k: "attr", obj, name, pos: posOf(n) }), head);
}

/** A path as an expression: an absolute one is `attr(qname(prefix), last)`, so values and members read alike. */
export function pathExpr(segs: string[], n: SyntaxNode, st: RustState): Expr {
  const r = resolveSegments(segs, st.file, st.locals);
  const pos = posOf(n);
  if (r.kind === "self") return members(st.selfType ?? { k: "name", name: "Self", pos }, r.rest, n);
  if (r.kind === "local") return members({ k: "name", name: r.segs[0]!, pos }, r.segs.slice(1), n);
  if (r.path.length === 1) return { k: "qname", path: r.path, pos };
  return { k: "attr", obj: { k: "qname", path: r.path.slice(0, -1), pos }, name: r.path.at(-1)!, pos };
}

/** Collects `use` aliases and glob imports: `use a::{b, c::d as e, self, f::*};`. */
export function lowerUse(arg: SyntaxNode | undefined, prefix: string[], st: RustState): void {
  if (!arg) return;
  const add = (alias: string, segs: string[]): void => {
    const r = resolveSegments(segs, st.file);
    // `use reqwest;`, `use Role::*`'s enum: an item of the file is under its module, anything else a crate
    const local = r.kind === "local" ? (st.file.items.has(r.segs[0]!) ? [...st.file.module, ...r.segs] : r.segs) : undefined;
    const path = r.kind === "abs" ? r.path : local;
    if (!path || path.join(".") === [...st.file.module, alias].join(".")) return;
    st.file.uses.set(alias, path);
    st.mod.imports.set(alias, { path });
    st.mod.importPaths.push(path);
  };
  switch (arg.type) {
    case "use_as_clause": {
      const segs = segmentsOf(field(arg, "path"));
      const alias = field(arg, "alias")?.text;
      if (segs && alias && alias !== "_") add(alias, [...prefix, ...segs]);
      return;
    }
    case "use_wildcard": {
      const segs = segmentsOf(named(arg)[0]);
      const r = segs ? resolveSegments([...prefix, ...segs], st.file) : undefined;
      if (r?.kind !== "abs") return;
      (st.mod.wildcards ??= []).push(r.path);
      st.mod.importPaths.push(r.path);
      return;
    }
    case "scoped_use_list": {
      const segs = segmentsOf(field(arg, "path")) ?? [];
      lowerUse(field(arg, "list"), [...prefix, ...segs], st);
      return;
    }
    case "use_list":
      for (const c of named(arg)) lowerUse(c, prefix, st);
      return;
    case "self":
      if (prefix.length > 0) add(prefix.at(-1)!, prefix);
      return;
    default: {
      const segs = segmentsOf(arg);
      if (segs && segs.length > 0) add(segs.at(-1)!, [...prefix, ...segs]);
    }
  }
}
