/**
 * Builds the Dart grammar's WebAssembly (`src/lang/dart/tree-sitter-dart.wasm`) from the grammar's source at a pinned
 * commit. The npm `tree-sitter-dart` release (1.0.0, 2023) is built for an older tree-sitter and does not load in
 * web-tree-sitter 0.27, so the grammar is built here and committed; the build copies it to `dist/grammars/` with the
 * others (`tsup.config.ts`).
 *
 * The tree-sitter CLI (the `tree-sitter-cli` dev dependency, its binary fetched on first use) compiles it with the
 * wasi-sdk and binaryen releases it pins, so the same commit and CLI give the same bytes:
 *
 *   pnpm gen:dart-grammar
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** github.com/UserNobody14/tree-sitter-dart, 2026-10-13 ("chore: bump to Node 24 and node-gyp 13.1.0 (#106)"). */
export const DART_GRAMMAR_REPO = "https://github.com/UserNobody14/tree-sitter-dart.git";
export const DART_GRAMMAR_COMMIT = "3f0c7a8309d89927e7cc6bef39569c815fddb2e5";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "src", "lang", "dart", "tree-sitter-dart.wasm");

/** The CLI binary of the dev dependency; its install script downloads it, and pnpm does not run install scripts. */
function treeSitterCli(): string {
  const pkg = path.dirname(createRequire(import.meta.url).resolve("tree-sitter-cli/package.json"));
  const bin = path.join(pkg, process.platform === "win32" ? "tree-sitter.exe" : "tree-sitter");
  if (!existsSync(bin)) execFileSync(process.execPath, ["install.js"], { cwd: pkg, stdio: "inherit" });
  return bin;
}

function checkout(dir: string): void {
  const git = (...args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: "inherit" });
  git("init", "-q");
  git("remote", "add", "origin", DART_GRAMMAR_REPO);
  git("fetch", "-q", "--depth", "1", "origin", DART_GRAMMAR_COMMIT);
  git("checkout", "-q", "FETCH_HEAD");
}

const work = mkdtempSync(path.join(tmpdir(), "api-grep-dart-grammar-"));
try {
  const src = path.join(work, "tree-sitter-dart");
  mkdirSync(src);
  checkout(src);
  execFileSync(treeSitterCli(), ["build", "--wasm", "-o", out, src], { cwd: work, stdio: "inherit" });
  // the grammar is MIT-licensed: its notice ships with the WebAssembly
  copyFileSync(path.join(src, "LICENSE"), out.replace(/\.wasm$/, ".LICENSE"));
  const sha = createHash("sha256").update(readFileSync(out)).digest("hex");
  console.log(`${path.relative(root, out)} from ${DART_GRAMMAR_COMMIT.slice(0, 12)}: sha256 ${sha}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
