import path from "node:path";
import { isInside, readConfigFile, realPath, relativePosix } from "../../files.js";
import { staticText } from "../../resolve/parts.js";
import type { Call } from "../../report/schema.js";
import type { Part } from "../../types.js";
import { errorText, readEnvHints } from "../files.js";
import { parserFor, type Parser, type SyntaxNode } from "../tree-sitter.js";
import type { LanguageFrontEnd, LanguageScanInput, LanguageScanResult } from "../types.js";
import { buildShellCall, type BuildCtx } from "./build.js";
import { extractRequests, type Found } from "./extract.js";
import { SHELL_EXCLUDES, shellFiles, shellLeftOut } from "./files.js";
import { collectScope, type FileScope } from "./scope.js";
import { withSourced } from "./sourced.js";
import { varParts, wordCtx, wordParts } from "./words.js";

/** Sourced files read per script, and names a sourced file can give. */
const MAX_SOURCES = 20;
const MAX_EXPORTS = 200;

type Exports = Map<string, Part[]>;

interface Session {
  parser: Parser;
  rootDir: string;
  /** Top-level names of sourced files, by absolute path (undefined: not readable). */
  exports: Map<string, Exports | undefined>;
}

function parse<T>(s: Session, text: string, read: (root: SyntaxNode) => T): T {
  const tree = s.parser.parse(text);
  if (!tree) throw new Error("the parser returned no tree");
  try {
    return read(tree.rootNode);
  } finally {
    tree.delete();
  }
}

/** The values a file's top-level assignments hold once it has run (`source ./config.sh` reads them). */
function exportsOf(scope: FileScope, root: SyntaxNode): Exports {
  const out: Exports = new Map();
  for (const [name, bindings] of scope.bindings) {
    if (out.size >= MAX_EXPORTS) break;
    if (!bindings.some((b) => b.fn === undefined && b.kind === "value")) continue;
    out.set(name, varParts(name, { ...wordCtx(scope, root), offset: root.endIndex }));
  }
  return out;
}

/** `source "$(dirname "$0")/env.sh"`, `. ./lib.sh`: the file, next to the script (or at the root), inside the repository. */
function sourcePath(node: SyntaxNode, scope: FileScope, file: string, rootDir: string): string | undefined {
  const parts = wordParts(node, wordCtx(scope, node));
  const lastHole = parts.reduce((last, p, i) => (p.kind !== "static" ? i : last), -1);
  const rel = staticText(parts.slice(lastHole + 1));
  if (!rel || (lastHole < 0 && (rel.startsWith("/") || rel.startsWith("~")))) return undefined;
  const bases = lastHole >= 0 ? [path.dirname(file)] : [path.dirname(file), rootDir];
  const root = realPath(rootDir);
  return bases.map((b) => path.join(b, rel.replace(/^\/+/, ""))).find((p) => isInside(root, realPath(p)) && readConfigFile(p, rootDir) !== undefined);
}

function sourcedExports(s: Session, scope: FileScope, file: string): Exports[] {
  const out: Exports[] = [];
  for (const node of scope.sources.slice(0, MAX_SOURCES)) {
    const p = sourcePath(node, scope, file, s.rootDir);
    if (!p) continue;
    if (!s.exports.has(p)) {
      const text = readConfigFile(p, s.rootDir);
      s.exports.set(p, text === undefined ? undefined : parse(s, text, (root) => exportsOf(collectScope(root), root)));
    }
    const e = s.exports.get(p);
    if (e) out.push(e);
  }
  return out;
}

/** Bytes of the file the parser could not read (its `ERROR` nodes), and the line of the first one. */
function unread(root: SyntaxNode): { bytes: number; line?: number } {
  const out: { bytes: number; line?: number } = { bytes: 0 };
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type === "ERROR") {
      out.bytes += n.endIndex - n.startIndex;
      out.line = Math.min(out.line ?? Infinity, n.startPosition.row + 1);
    } else for (const c of n.children) if (c?.hasError) stack.push(c);
  }
  return out;
}

class ParseError extends Error {}

function scanFile(s: Session, file: string, wrappers: boolean): Found[] {
  const text = readConfigFile(file, s.rootDir);
  if (text === undefined) throw new Error("not a regular file of at most 4 MB");
  const { found, sourced } = parse(s, text, (root) => {
    // the grammar is bash's: a zsh script can hold syntax it does not read. The rest of a file is read; a file mostly
    // unread is reported, not scanned
    const bad = root.hasError ? unread(root) : { bytes: 0 };
    if (bad.bytes * 2 > text.length) throw new ParseError(`syntax error at line ${bad.line ?? 1}`);
    const scope = collectScope(root);
    return { found: extractRequests(root, scope, wrappers), sourced: sourcedExports(s, scope, file) };
  });
  return withSourced(found, sourced);
}

function buildAll(found: Found[], rel: string, ctx: BuildCtx, input: LanguageScanInput): Call[] {
  const calls: Call[] = [];
  for (const f of found) {
    try {
      calls.push(...buildShellCall(f.req, { file: rel, line: f.line, col: f.col, language: "shell" }, f.via, ctx));
    } catch (err) {
      input.diag.drop({ file: rel, line: f.line, reason: "internal-error", detail: errorText(err) });
    }
  }
  return calls;
}

/** A data file (`-d @payload.json`) next to the script, inside the repository. */
function dataReader(file: string, rootDir: string): BuildCtx["readFile"] {
  return (parts) => {
    const rel = staticText(parts);
    return rel && !rel.startsWith("/") && rel !== "-" ? readConfigFile(path.join(path.dirname(file), rel), rootDir) : undefined;
  };
}

async function scanShell(input: LanguageScanInput): Promise<LanguageScanResult | undefined> {
  const { rootDir, opts, diag } = input;
  const files = shellFiles(rootDir, opts.include, [...SHELL_EXCLUDES, ...(opts.exclude ?? [])]);
  const leftOut = shellLeftOut({ dir: rootDir, include: opts.include, exclude: opts.exclude }, new Set(files));
  if (files.length === 0 && leftOut.length === 0) return undefined;
  if (!input.changed) for (const l of leftOut) diag.skip(l);
  const selected = input.changed ? files.filter((f) => input.changed!.has(f)) : files;
  const session: Session = { parser: await parserFor("bash"), rootDir, exports: new Map() };
  const envHints = readEnvHints(rootDir);
  const calls: Call[] = [];
  let scanned = 0;
  try {
    for (const file of selected) {
      const rel = relativePosix(rootDir, file);
      try {
        const found = scanFile(session, file, opts.wrappers !== false);
        calls.push(...buildAll(found, rel, { envHints, readFile: dataReader(file, rootDir) }, input));
        scanned++;
      } catch (err) {
        diag.skip({ file: rel, reason: err instanceof ParseError ? "parse-error" : "internal-error", detail: errorText(err) });
      }
    }
  } finally {
    session.parser.delete();
  }
  const seen = input.changed ? selected.length : files.length + leftOut.length;
  return { calls, files: { shell: { filesSeen: seen, filesScanned: scanned } }, coverage: [] };
}

/** Shell scripts: curl, wget and HTTPie command lines, read without running anything. */
export const shell: LanguageFrontEnd = { ids: ["shell"], scan: scanShell };
