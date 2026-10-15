import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { Project, ts, type SourceFile } from "ts-morph";
import { BoundedFileSystem } from "./bounded-fs.js";
import { isInside, realPath, relativePosix } from "./files.js";
import { leanResolution } from "./module-resolution.js";
import { globMatcher, languageFiles, leftOutFiles, readEnvHints, SHARED_EXCLUDES, type LeftOut } from "./lang/files.js";
import { parseHtml, type HtmlDoc } from "./lang/html/extract.js";
import { readRoot, tsconfigFor, type TsconfigChoice } from "./tsconfig.js";

export { readEnvHints, type LeftOut } from "./lang/files.js";

/** Languages the TypeScript checker reads: HTML through the inline scripts of a page. */
export type CheckerLanguage = "typescript" | "javascript" | "html";

export const EXTENSIONS: Record<CheckerLanguage, string[]> = {
  typescript: [".ts", ".tsx", ".mts", ".cts"],
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  html: [".html", ".htm"],
};

export const TS_EXTENSIONS = EXTENSIONS.typescript;

const TEST_FILES = ["ts", "tsx", "js", "jsx", "mjs", "cjs"].flatMap((ext) => [`**/*.test.${ext}`, `**/*.spec.${ext}`, `**/*.e2e-spec.${ext}`]);

export const DEFAULT_EXCLUDES = [
  ...SHARED_EXCLUDES,
  "**/.next/**",
  ...TEST_FILES,
  "**/__mocks__/**",
  "**/__tests__/**",
  // test directories and test runner configuration: imports there are not the app's use of an SDK
  "**/test/**",
  "**/tests/**",
  "**/integration_test/**",
  "**/integration_tests/**",
  "**/cypress/**",
  ...["jest.config", "jest.setup", "vitest.config", "vitest.setup", "vitest.workspace", "playwright.config", "karma.conf", "setupTests"].map((n) => `**/${n}.*`),
  "**/__testfixtures__/**",
  "**/*.d.ts",
  // bundled, minified and vendored JavaScript is build output, not the repository's code
  "**/*.min.js",
  "**/*.min.mjs",
  "**/*.bundle.js",
  "**/*.chunk.js",
  "**/vendor/**",
  "**/bower_components/**",
  "**/coverage/**",
  "**/.nuxt/**",
  "**/.output/**",
  "**/.svelte-kit/**",
  "**/storybook-static/**",
];

export interface LoadOptions {
  dir: string;
  tsconfig?: string;
  include?: string[];
  exclude?: string[];
  /** Default: TypeScript only. */
  languages?: CheckerLanguage[];
}

/** What every batch of a scan shares: the files in scope, the compiler options, the HTML pages. */
export interface Scope {
  dir: string;
  /** What the checker may read (#112): the repository holding `dir`, or `dir` outside any (`readRoot`). */
  root: string;
  opts: LoadOptions;
  tsconfig?: string;
  /** Files in scope (absolute paths), in the order they are loaded. */
  files: string[];
  options: ts.CompilerOptions;
  /** HTML pages in scope: their forms and CDN scripts (inline scripts become source files of a batch). */
  html: Map<string, HtmlDoc>;
  envHints: Record<string, string>;
  /** HTML pages that could not be read. */
  unreadable: Unreadable[];
}

/** Some files of the scope in a project of their own. */
export interface Loaded {
  project: Project;
  /** Files to scan: those of the batch, and what they import inside the scanned directory. */
  files: SourceFile[];
  /** Files the parser could not load (a stack overflow on absurd nesting, an unreadable file). */
  unreadable: Unreadable[];
}

export interface Unreadable {
  /** Absolute path. */
  path: string;
  /** Path relative to the scanned directory. */
  file: string;
  detail: string;
}

/** The first `bytes` of a regular file, or undefined when it cannot be read (a FIFO named `x.ts` would never answer). */
function head(file: string, bytes: number): Buffer | undefined {
  try {
    if (!statSync(file).isFile()) return undefined;
    const buf = Buffer.alloc(bytes);
    const fd = openSync(file, "r");
    try {
      return buf.subarray(0, readSync(fd, buf, 0, bytes, 0));
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

/** A minified file has very long lines: one over 2,000 characters in its first 8 KB. A file that cannot be read is not. */
function looksMinified(file: string): boolean {
  try {
    if (statSync(file).size < 8_000) return false;
  } catch {
    return false;
  }
  return !!head(file, 8_192)?.toString("utf8").split("\n").some((l) => l.length > 2_000);
}

/**
 * `.ts` is also the extension of Qt Linguist translations (XML) and MPEG transport streams (binary): neither is
 * TypeScript, and parsing one only yields syntax errors. A file that cannot be read is left to the parser.
 */
function notTypeScript(file: string): boolean {
  const buf = head(file, 512);
  if (!buf) return false;
  if (buf.includes(0)) return true;
  return /^\uFEFF?\s*(?:<\?xml|<!DOCTYPE|<TS\s)/.test(buf.toString("utf8"));
}

const extensionsOf = (languages: CheckerLanguage[]): string[] => languages.flatMap((l) => EXTENSIONS[l]);

/** Files of the checker's languages in scope (an `--include` glob only ever selects these extensions). */
export function tsFiles(dir: string, include: string[] | undefined, exclude: string[] = [], languages: CheckerLanguage[] = ["typescript"]): string[] {
  const files = languageFiles(dir, extensionsOf(languages), include, [...DEFAULT_EXCLUDES, ...exclude]);
  return files.filter((f) => !looksLikeBuildOrData(f));
}

/** Minified JavaScript, or a `.ts` file that is not TypeScript: in scope by its extension, not by its content. */
function looksLikeBuildOrData(file: string): boolean {
  if (/\.(?:c|m)?jsx?$/.test(file)) return looksMinified(file);
  return /\.[cm]?ts$/.test(file) && notTypeScript(file);
}

/** Files under `dir`, also once symlinks are resolved: a committed symlink cannot pull in a file from elsewhere on disk. */
function selectFiles(project: Project, dir: string, opts: LoadOptions, exclude: string[]): SourceFile[] {
  const excluded = globMatcher(dir, exclude);
  const included = globMatcher(dir, opts.include);
  const realDir = realPath(dir);
  const exts = extensionsOf(opts.languages ?? ["typescript"]);
  return project.getSourceFiles().filter((sf) => {
    const fp = sf.getFilePath();
    if (!isInside(dir, fp) || !exts.some((e) => fp.endsWith(e))) return false;
    if (sf.isDeclarationFile() || sf.isFromExternalLibrary()) return false;
    if (excluded?.(fp) || (included && !included(fp))) return false;
    return isInside(realDir, realPath(fp));
  });
}

/**
 * One by one: `addSourceFilesAtPaths` reads paths as globs, so a directory named `app [beta]` matched nothing. An HTML
 * page becomes a JavaScript file of the same path holding its inline scripts, at their positions in the page.
 */
function addFiles(project: Project, dir: string, files: string[], html: Map<string, HtmlDoc>): Unreadable[] {
  const unreadable: Unreadable[] = [];
  for (const f of files) {
    try {
      const doc = html.get(f);
      if (!doc) project.addSourceFileAtPath(f);
      else if (doc.script) project.createSourceFile(f, doc.script, { overwrite: true, scriptKind: ts.ScriptKind.JS });
    } catch (err) {
      unreadable.push(unreadableFile(dir, f, err));
    }
  }
  return unreadable;
}

function unreadableFile(dir: string, f: string, err: unknown): Unreadable {
  return { path: f, file: relativePosix(dir, f), detail: (err instanceof Error ? err.message : String(err)).split("\n")[0]! };
}

/** HTML pages, read once for every batch. */
function readPages(dir: string, files: string[]): { html: Map<string, HtmlDoc>; unreadable: Unreadable[] } {
  const html = new Map<string, HtmlDoc>();
  const unreadable: Unreadable[] = [];
  for (const f of files.filter((p) => /\.html?$/i.test(p))) {
    try {
      html.set(f, parseHtml(readFileSync(f, "utf8")));
    } catch (err) {
      unreadable.push(unreadableFile(dir, f, err));
    }
  }
  return { html, unreadable };
}

/** JavaScript is read with the TypeScript checker (no type errors reported, no JavaScript from node_modules). */
function compilerOptions(languages: CheckerLanguage[]): ts.CompilerOptions {
  if (languages.every((l) => l === "typescript")) return {};
  return { allowJs: true, checkJs: false, maxNodeModuleJsDepth: 0, ...(languages.includes("html") ? { allowNonTsExtensions: true } : {}) };
}

/** The compiler options of a scan: its tsconfig and what that extends are read inside `bound` only. */
function compilerOptionsOf({ file, bound }: TsconfigChoice, languages: CheckerLanguage[]): ts.CompilerOptions {
  const extra = compilerOptions(languages);
  if (!file) return { skipLibCheck: true, noEmit: true, allowJs: false, strict: false, esModuleInterop: true, ...extra };
  const fileSystem = bound === undefined ? undefined : new BoundedFileSystem(bound);
  const project = new Project({ resolutionHost: leanResolution, fileSystem, tsConfigFilePath: file, skipAddingFilesFromTsConfig: true, compilerOptions: { skipLibCheck: true, noEmit: true, ...extra } });
  return project.getCompilerOptions();
}

export function scopeOf(opts: LoadOptions): Scope {
  const dir = path.resolve(opts.dir);
  const languages = opts.languages ?? ["typescript"];
  const choice = tsconfigFor(dir, opts.tsconfig);
  const tsconfig = choice.file;
  const files = tsFiles(dir, opts.include, opts.exclude, languages);
  // the tsconfig may be above `dir` (in its repository): read here, not by the batches
  const options = compilerOptionsOf(choice, languages);
  return { dir, root: readRoot(dir), opts, tsconfig, files, options, ...readPages(dir, files), envHints: readEnvHints(dir) };
}

/** Some files of the scope in a project of their own, with what they import. */
export function loadBatch(scope: Scope, files: string[]): Loaded {
  const { dir, opts, tsconfig } = scope;
  const project = new Project({ resolutionHost: leanResolution, fileSystem: new BoundedFileSystem(scope.root), compilerOptions: scope.options });
  const unreadable = addFiles(project, dir, files, scope.html);
  if (tsconfig) {
    try {
      project.resolveSourceFileDependencies();
    } catch {
      // imported files only sharpen types: the files in scope are still scanned without them
    }
  }
  return { project, files: selectFiles(project, dir, opts, [...DEFAULT_EXCLUDES, ...(opts.exclude ?? [])]), unreadable };
}

/** Source files in scope that --exclude / --include left out, given the files kept (unreadable ones included). */
export function leftOutOf(scope: Scope, kept: Iterable<string>): LeftOut[] {
  const { dir, opts } = scope;
  const all = new Set<string>([...kept, ...scope.html.keys()]);
  return leftOutFiles({ dir, include: opts.include, exclude: opts.exclude }, extensionsOf(opts.languages ?? ["typescript"]), DEFAULT_EXCLUDES, all, (f) => !looksLikeBuildOrData(f));
}
