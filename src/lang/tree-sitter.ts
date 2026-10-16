import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser, type Node, type Tree } from "web-tree-sitter";
import { BUILT_GRAMMARS, GRAMMARS } from "./grammars.js";

export type { Node as SyntaxNode, Parser, Tree } from "web-tree-sitter";

let init: Promise<void> | undefined;
const grammars = new Map<string, Promise<Language>>();

/**
 * Grammar `.wasm` files: copied next to the bundle by the build (`dist/grammars/`), else read from the grammar's dev
 * dependency (tests, `pnpm dev`), or from the source tree for a grammar built and committed (`BUILT_GRAMMARS`). The
 * grammar packages are never runtime dependencies: they build native bindings on install, and only their WebAssembly
 * is used.
 */
function grammarPath(name: string): string {
  const file = `tree-sitter-${name}.wasm`;
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const dir of [path.join(here, "grammars"), path.join(here, "..", "grammars")]) {
    if (existsSync(path.join(dir, file))) return path.join(dir, file);
  }
  const built = BUILT_GRAMMARS[name];
  if (built) return path.join(here, built);
  return createRequire(import.meta.url).resolve(`${GRAMMARS[name] ?? `tree-sitter-${name}`}/${file}`);
}

/** A parser for one grammar (`python`, `php`); the WebAssembly runtime and grammar load once, on first use. */
export async function parserFor(name: string): Promise<Parser> {
  init ??= Parser.init();
  await init;
  let lang = grammars.get(name);
  if (!lang) {
    lang = Language.load(grammarPath(name));
    grammars.set(name, lang);
  }
  const parser = new Parser();
  parser.setLanguage(await lang);
  return parser;
}

/** The 1-based line of a tree's first ERROR or MISSING node, if any. */
export function syntaxErrorLine(tree: Tree): number | undefined {
  const bad = tree.rootNode.hasError ? firstError(tree.rootNode) : undefined;
  return bad ? bad.startPosition.row + 1 : undefined;
}

/**
 * The first syntax error of a tree, as `syntax error at line N`; undefined when the file parsed cleanly. With
 * `allowHidden`, a tree whose only errors are tokens the parser inserted and hides (no ERROR or MISSING node to point
 * at) counts as parsed.
 */
export function syntaxError(tree: Tree, allowHidden = false): string | undefined {
  if (!tree.rootNode.hasError) return undefined;
  const bad = firstError(tree.rootNode);
  if (bad) return `syntax error at line ${bad.startPosition.row + 1}`;
  return allowHidden ? undefined : "syntax error";
}

function firstError(n: Node): Node | undefined {
  if (n.isError || n.isMissing) return n;
  for (const c of n.children) {
    if (c && (c.hasError || c.isMissing)) {
      const hit = firstError(c);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** A named child by field, or undefined (tree-sitter returns null). */
export function field(n: Node, name: string): Node | undefined {
  return n.childForFieldName(name) ?? undefined;
}

export function named(n: Node): Node[] {
  return n.namedChildren.filter((c): c is Node => !!c);
}
