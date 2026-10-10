import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { Project, ts, type SourceFile } from "ts-morph";
import { isConfigFile, isInside, realPath, relativePosix } from "./files.js";
import { globMatcher, languageFiles, leftOutFiles, readEnvHints, SHARED_EXCLUDES, type LeftOut } from "./lang/files.js";
import { parseHtml, type HtmlDoc } from "./lang/html/extract.js";

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

export interface Loaded {
  project: Project;
  files: SourceFile[];
  /** HTML pages in scope: their forms and CDN scripts (inline scripts are source files of the project). */
  html: Map<string, HtmlDoc>;
  envHints: Record<string, string>;
  /** Source files in scope that --exclude / --include left out (paths relative to the scanned directory). */
  leftOut: LeftOut[];
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

/** The nearest tsconfig.json, or jsconfig.json for a JavaScript project (path aliases live there too). */
function findTsconfig(dir: string): string | undefined {
  let cur = path.resolve(dir);
  for (let i = 0; i < 5; i++) {
    const candidate = ["tsconfig.json", "jsconfig.json"].map((name) => path.join(cur, name)).find(isConfigFile);
    if (candidate) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return undefined;
}

/** A minified file has very long lines: one over 2,000 characters in its first 8 KB. A file that cannot be read is not. */
function looksMinified(file: string): boolean {
  try {
    if (statSync(file).size < 8_000) return false;
    const buf = Buffer.alloc(8_192);
    const fd = openSync(file, "r");
    try {
      readSync(fd, buf, 0, buf.length, 0);
    } finally {
      closeSync(fd);
    }
    return buf.toString("utf8").split("\n").some((l) => l.length > 2_000);
  } catch {
    return false;
  }
}

const extensionsOf = (languages: CheckerLanguage[]): string[] => languages.flatMap((l) => EXTENSIONS[l]);

/** Files of the checker's languages in scope (an `--include` glob only ever selects these extensions). */
export function tsFiles(dir: string, include: string[] | undefined, exclude: string[] = [], languages: CheckerLanguage[] = ["typescript"]): string[] {
  const files = languageFiles(dir, extensionsOf(languages), include, [...DEFAULT_EXCLUDES, ...exclude]);
  return files.filter((f) => !/\.(?:c|m)?jsx?$/.test(f) || !looksMinified(f));
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
      if (!/\.html?$/i.test(f)) {
        project.addSourceFileAtPath(f);
        continue;
      }
      const doc = parseHtml(readFileSync(f, "utf8"));
      html.set(f, doc);
      if (doc.script) project.createSourceFile(f, doc.script, { overwrite: true, scriptKind: ts.ScriptKind.JS });
    } catch (err) {
      unreadable.push({ path: f, file: relativePosix(dir, f), detail: (err instanceof Error ? err.message : String(err)).split("\n")[0]! });
    }
  }
  return unreadable;
}

/** JavaScript is read with the TypeScript checker (no type errors reported, no JavaScript from node_modules). */
function compilerOptions(languages: CheckerLanguage[]): ts.CompilerOptions {
  if (languages.every((l) => l === "typescript")) return {};
  return { allowJs: true, checkJs: false, maxNodeModuleJsDepth: 0, ...(languages.includes("html") ? { allowNonTsExtensions: true } : {}) };
}

function createProject(tsconfig: string | undefined, languages: CheckerLanguage[]): Project {
  const extra = compilerOptions(languages);
  if (!tsconfig) return new Project({ compilerOptions: { skipLibCheck: true, noEmit: true, allowJs: false, strict: false, esModuleInterop: true, ...extra } });
  return new Project({ tsConfigFilePath: tsconfig, skipAddingFilesFromTsConfig: true, compilerOptions: { skipLibCheck: true, noEmit: true, ...extra } });
}

function tsconfigFor(dir: string, explicit: string | undefined): string | undefined {
  if (!explicit) return findTsconfig(dir);
  const file = path.resolve(explicit);
  if (!isConfigFile(file)) throw new Error(`tsconfig not found: ${file}`);
  return file;
}

export function loadProject(opts: LoadOptions): Loaded {
  const dir = path.resolve(opts.dir);
  const languages = opts.languages ?? ["typescript"];
  const exclude = [...DEFAULT_EXCLUDES, ...(opts.exclude ?? [])];
  const tsconfig = tsconfigFor(dir, opts.tsconfig);
  const project = createProject(tsconfig, languages);
  const html = new Map<string, HtmlDoc>();
  const unreadable = addFiles(project, dir, tsFiles(dir, opts.include, opts.exclude, languages), html);
  if (tsconfig) {
    try {
      project.resolveSourceFileDependencies();
    } catch {
      // imported files only sharpen types: the files in scope are still scanned without them
    }
  }
  const files = selectFiles(project, dir, opts, exclude);
  // an unreadable file is already reported as such
  const kept = new Set<string>([...files.map((sf) => sf.getFilePath() as string), ...html.keys(), ...unreadable.map((u) => u.path)]);
  const leftOut = leftOutFiles({ dir, include: opts.include, exclude: opts.exclude }, extensionsOf(languages), DEFAULT_EXCLUDES, kept);
  return { project, files, html, envHints: readEnvHints(dir), leftOut, unreadable };
}
