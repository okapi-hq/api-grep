import path from "node:path";
import { ts } from "ts-morph";
import { realPath } from "../../files.js";
import { factsOf, NO_FACTS, words, type FileFacts } from "./facts.js";

/**
 * Files that can see each other, so that each group can be scanned with a checker of its own (#68). A file can only
 * reach what it imports, transitively, and what is global; a function's callers are the files that reach it. Two files
 * are in one group when an import, a `/// <reference>`, a `declare module` or a global name links them, in either
 * direction, through files in scope or the other code the checker loads (a sibling package of a monorepo; never
 * node_modules). Anything uncertain links more, never less: a group is then larger, never wrong.
 */
export interface GraphInput {
  /** Files in scope (absolute paths). */
  files: string[];
  options: ts.CompilerOptions;
  /** The text the checker reads for a file in scope (an HTML page: its inline scripts), undefined when unreadable. */
  textOf: (file: string) => string | undefined;
}

/** Source files a program loads besides those in scope: `.json` and assets import nothing. */
const LOADABLE = /\.[cm]?[jt]sx?$/i;

const { ModuleKind: M, ModuleResolutionKind: R } = ts;
/** Module kinds whose default resolution reads no `exports` conditions (node10 or classic). */
const PLAIN_MODULES = new Set([undefined, M.None, M.CommonJS, M.AMD, M.UMD, M.System, M.ES2015, M.ES2020, M.ES2022, M.ESNext]);

/** Node16, NodeNext and bundler resolution read `import` and `require` differently: both are followed. */
function modesOf(o: ts.CompilerOptions): ts.ResolutionMode[] {
  const plain = o.moduleResolution === R.Node10 || o.moduleResolution === R.Classic || (o.moduleResolution === undefined && PLAIN_MODULES.has(o.module));
  return plain ? [undefined] : [undefined, M.ESNext, M.CommonJS];
}

class UnionFind {
  private readonly parent: number[] = [];

  add(): number {
    this.parent.push(this.parent.length);
    return this.parent.length - 1;
  }

  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root]!;
    for (let j = i; this.parent[j] !== root; ) {
      const next = this.parent[j]!;
      this.parent[j] = root;
      j = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

class Graph {
  readonly sets = new UnionFind();
  readonly paths: string[] = [];
  readonly facts: FileFacts[] = [];
  private readonly ids = new Map<string, number>();
  private readonly real = new Map<string, string>();
  private readonly cache: ts.ModuleResolutionCache;
  private readonly modes: ts.ResolutionMode[];

  constructor(private readonly input: GraphInput) {
    this.cache = ts.createModuleResolutionCache(process.cwd(), (f) => f, input.options);
    this.modes = modesOf(input.options);
    // one node per file in scope, even when two paths are one file through a symlink: indexes match `input.files`
    for (const f of input.files) {
      const id = this.sets.add();
      this.paths.push(f);
      const key = this.realPath(f);
      const same = this.ids.get(key);
      if (same === undefined) this.ids.set(key, id);
      else this.sets.union(id, same);
    }
  }

  /** The node of a file, added on first sight; files in scope come first, in their order. */
  node(file: string): number {
    const key = this.realPath(file);
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.sets.add();
      this.ids.set(key, id);
      this.paths.push(file);
    }
    return id;
  }

  private realPath(file: string): string {
    let out = this.real.get(file);
    if (out === undefined) this.real.set(file, (out = realPath(file)));
    return out;
  }

  /** The group of every file reached, by path as given and once symlinks are resolved. */
  roots(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [key, id] of this.ids) out.set(key, this.sets.find(id));
    this.paths.forEach((p, id) => out.set(p, this.sets.find(id)));
    return out;
  }

  text(id: number): string | undefined {
    const file = this.paths[id]!;
    return id < this.input.files.length ? this.input.textOf(file) : ts.sys.readFile(file);
  }

  /** Reads every file reached, in scope or not, and links each to what it imports. */
  build(): void {
    for (let id = 0; id < this.paths.length; id++) {
      const text = this.text(id);
      let facts = NO_FACTS;
      try {
        if (text !== undefined) facts = factsOf(this.paths[id]!, text);
      } catch {
        // a file the parser cannot read (absurd nesting) is not loaded by the checker either
      }
      this.facts.push(facts);
      for (const target of this.targets(this.paths[id]!, facts)) this.sets.union(id, this.node(target));
    }
  }

  private targets(file: string, facts: FileFacts): string[] {
    const out = new Set<string>();
    const { options } = this.input;
    for (const spec of facts.specifiers) {
      for (const mode of this.modes) {
        const r = ts.resolveModuleName(spec, file, options, ts.sys, this.cache, undefined, mode).resolvedModule;
        if (r && !r.isExternalLibraryImport) out.add(r.resolvedFileName);
      }
    }
    for (const ref of facts.references) {
      const p = path.resolve(path.dirname(file), ref);
      for (const candidate of [p, `${p}.ts`, `${p}.d.ts`, `${p}.tsx`, `${p}.js`]) if (ts.sys.fileExists(candidate)) out.add(candidate);
    }
    for (const name of facts.typeRefs) {
      const r = ts.resolveTypeReferenceDirective(name, file, options, ts.sys).resolvedTypeReferenceDirective;
      if (r?.resolvedFileName && !r.isExternalLibraryImport) out.add(r.resolvedFileName);
    }
    return [...out].filter((t) => LOADABLE.test(t));
  }
}

/** `declare module "*.svg"` covers `./logo.svg`. */
function ambientMatcher(name: string): (spec: string) => boolean {
  const star = name.indexOf("*");
  if (star < 0) return (spec) => spec === name;
  const [prefix, suffix] = [name.slice(0, star), name.slice(star + 1)];
  return (spec) => spec.length >= prefix.length + suffix.length && spec.startsWith(prefix) && spec.endsWith(suffix);
}

/** Links a `declare module "x"` block to every file importing `x`: it declares or augments that module. */
function linkAmbient(g: Graph): void {
  const blocks = g.facts.flatMap((f, id) => f.ambient.map((name) => ({ id, matches: ambientMatcher(name) })));
  if (blocks.length === 0) return;
  g.facts.forEach((f, id) => {
    for (const spec of f.specifiers) for (const b of blocks) if (b.matches(spec)) g.sets.union(id, b.id);
  });
}

/** Links a file declaring global types that need no name to every file. */
function linkUniversal(g: Graph): void {
  const first = g.facts.findIndex((f) => f.universal);
  if (first < 0) return;
  for (let id = 0; id < g.paths.length; id++) g.sets.union(first, id);
}

/** Links a file declaring global names to every file whose text has one of them. */
function linkGlobals(g: Graph): void {
  const declaredBy = new Map<string, number>();
  g.facts.forEach((f, id) => {
    for (const name of f.globals) {
      const other = declaredBy.get(name);
      if (other === undefined) declaredBy.set(name, id);
      else g.sets.union(id, other);
    }
  });
  if (declaredBy.size === 0) return;
  for (let id = 0; id < g.paths.length; id++) {
    const text = g.text(id);
    if (text === undefined) continue;
    for (const w of words(text)) {
      const other = declaredBy.get(w);
      if (other !== undefined) g.sets.union(id, other);
    }
  }
}

export interface FileGroups {
  /** Files in scope that can see each other (indexes into `GraphInput.files`), ordered by their first file. */
  groups: number[][];
  /** The group of any file the graph reached, in scope or not (an id, not an index into `groups`). */
  groupOf: (file: string) => number | undefined;
}

export function fileGroups(input: GraphInput): FileGroups {
  const g = new Graph(input);
  g.build();
  linkAmbient(g);
  linkGlobals(g);
  linkUniversal(g);
  const groups = new Map<number, number[]>();
  input.files.forEach((_, i) => {
    const root = g.sets.find(i);
    const group = groups.get(root);
    if (group) group.push(i);
    else groups.set(root, [i]);
  });
  return { groups: [...groups.values()], groupOf: lookup(g.roots()) };
}

/** A closure of its own: one made in `fileGroups` would keep the whole graph (and the texts it read) alive. */
function lookup(roots: Map<string, number>): (file: string) => number | undefined {
  return (file) => roots.get(file) ?? roots.get(realPath(file));
}
