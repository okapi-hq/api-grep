/**
 * Tree-sitter grammars the tree-sitter languages parse with, by name, and the dev dependency each `.wasm` comes from.
 * The build copies them next to the bundle (`tsup.config.ts`); only their WebAssembly ships.
 */
export const GRAMMARS: Record<string, string> = {
  python: "tree-sitter-python",
  php: "tree-sitter-php",
  // the maintained Kotlin grammar; the unscoped `tree-sitter-kotlin` package ships no `.wasm`
  kotlin: "@tree-sitter-grammars/tree-sitter-kotlin",
  java: "tree-sitter-java",
  go: "tree-sitter-go",
  bash: "tree-sitter-bash",
  rust: "tree-sitter-rust",
};

/**
 * Grammars built from their source and committed, by name: their `.wasm` (and license) under `src/lang/`. No npm
 * release of the Dart grammar loads in web-tree-sitter 0.27; `pnpm gen:dart-grammar` rebuilds it at a pinned commit.
 */
export const BUILT_GRAMMARS: Record<string, string> = {
  dart: "dart/tree-sitter-dart.wasm",
};
