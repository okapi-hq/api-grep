import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { Project, ts, type SourceFile } from "ts-morph";
import { languageFiles, leftOutFiles, matchesAny, readEnvHints, SHARED_EXCLUDES, type LeftOut } from "./lang/files.js";
import { parseHtml, type HtmlDoc } from "./lang/html/extract.js";

export { globToRegExp, readEnvHints, type LeftOut } from "./lang/files.js";

/** Languages the TypeScript checker reads: HTML through the inline scripts of a page. */
export type CheckerLanguage = "typescript" | "javascript" | "html";

export const EXTENSIONS: Record<CheckerLanguage, string[]> = {
  typescript: [".ts", ".tsx", ".mts", ".cts"],
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  html: [".html", ".htm"],
};

export const TS_EXTENSIONS = EXTENSIONS.typescript;

const TEST_FILES = ["ts", "tsx", "js", "jsx", "mjs", "cjs"].flatMap((ext) => [`**/*.test.${ext}`, `**/*.spec.${ext}`]);

export const DEFAULT_EXCLUDES = [
  ...SHARED_EXCLUDES,
  "**/.next/**",
  ...TEST_FILES,
  "**/__mocks__/**",
  "**/__tests__/**",
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
}

/** The nearest tsconfig.json, or jsconfig.json for a JavaScript project (path aliases live there too). */
function findTsconfig(dir: string): string | undefined {
  let cur = path.resolve(dir);
  for (let i = 0; i < 5; i++) {
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const candidate = path.join(cur, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return undefined;
}

/** A minified file has very long lines: one over 2,000 characters in its first 8 KB. */
function looksMinified(file: string): boolean {
  if (statSync(file).size < 8_000) return false;
  const buf = Buffer.alloc(8_192);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buf, 0, buf.length, 0);
  } finally {
    closeSync(fd);
  }
  return buf.toString("utf8").split("\n").some((l) => l.length > 2_000);
}

const extensionsOf = (languages: CheckerLanguage[]): string[] => languages.flatMap((l) => EXTENSIONS[l]);

/** Files of the checker's languages in scope (an `--include` glob only ever selects these extensions). */
export function tsFiles(dir: string, include: string[] | undefined, exclude: string[] = [], languages: CheckerLanguage[] = ["typescript"]): string[] {
  const files = languageFiles(dir, extensionsOf(languages), include, [...DEFAULT_EXCLUDES, ...exclude]);
  return files.filter((f) => !/\.(?:c|m)?jsx?$/.test(f) || !looksMinified(f));
}

function selectFiles(project: Project, dir: string, opts: LoadOptions, exclude: string[]): SourceFile[] {
  const abs = path.resolve(dir);
  const exts = extensionsOf(opts.languages ?? ["typescript"]);
  return project.getSourceFiles().filter((sf) => {
    const fp = sf.getFilePath();
    if (!fp.startsWith(abs) || !exts.some((e) => fp.endsWith(e))) return false;
    if (sf.isDeclarationFile() || sf.isFromExternalLibrary()) return false;
    if (matchesAny(fp, abs, exclude)) return false;
    if (opts.include && opts.include.length > 0 && !matchesAny(fp, abs, opts.include)) return false;
    return true;
  });
}

/**
 * One by one: `addSourceFilesAtPaths` reads paths as globs, so a directory named `app [beta]` matched nothing. An HTML
 * page becomes a JavaScript file of the same path holding its inline scripts, at their positions in the page.
 */
function addFiles(project: Project, files: string[], html: Map<string, HtmlDoc>): void {
  for (const f of files) {
    if (!/\.html?$/i.test(f)) {
      project.addSourceFileAtPath(f);
      continue;
    }
    const doc = parseHtml(readFileSync(f, "utf8"));
    html.set(f, doc);
    if (doc.script) project.createSourceFile(f, doc.script, { overwrite: true, scriptKind: ts.ScriptKind.JS });
  }
}

/** JavaScript is read with the TypeScript checker (no type errors reported, no JavaScript from node_modules). */
function compilerOptions(languages: CheckerLanguage[]): ts.CompilerOptions {
  if (languages.every((l) => l === "typescript")) return {};
  return { allowJs: true, checkJs: false, maxNodeModuleJsDepth: 0, ...(languages.includes("html") ? { allowNonTsExtensions: true } : {}) } as ts.CompilerOptions;
}

export function loadProject(opts: LoadOptions): Loaded {
  const dir = path.resolve(opts.dir);
  const languages = opts.languages ?? ["typescript"];
  const exclude = [...DEFAULT_EXCLUDES, ...(opts.exclude ?? [])];
  const tsconfig = opts.tsconfig ? path.resolve(opts.tsconfig) : findTsconfig(dir);
  const html = new Map<string, HtmlDoc>();
  const extra = compilerOptions(languages);
  const project = tsconfig
    ? new Project({ tsConfigFilePath: tsconfig, skipAddingFilesFromTsConfig: true, compilerOptions: { skipLibCheck: true, noEmit: true, ...extra } })
    : new Project({ compilerOptions: { skipLibCheck: true, noEmit: true, allowJs: false, strict: false, esModuleInterop: true, ...extra } });
  addFiles(project, tsFiles(dir, opts.include, opts.exclude, languages), html);
  if (tsconfig) project.resolveSourceFileDependencies();
  const files = selectFiles(project, dir, opts, exclude);
  const kept = new Set([...files.map((sf) => sf.getFilePath() as string), ...html.keys()]);
  const leftOut = leftOutFiles({ dir, include: opts.include, exclude: opts.exclude }, extensionsOf(languages), DEFAULT_EXCLUDES, kept);
  return { project, files, html, envHints: readEnvHints(dir), leftOut };
}

/** Why a file cannot be read reliably: a syntax error, or an import whose module specifier is not a string literal. */
export function unreadable(sf: SourceFile): string | undefined {
  const syntax = sf.getProject().getProgram().compilerObject.getSyntacticDiagnostics(sf.compilerNode)[0];
  if (syntax) return ts.flattenDiagnosticMessageText(syntax.messageText, " ");
  const decls = [...sf.getImportDeclarations(), ...sf.getExportDeclarations()];
  const bad = decls.some((d) => d.compilerNode.moduleSpecifier !== undefined && !ts.isStringLiteral(d.compilerNode.moduleSpecifier));
  return bad ? "Expected the module specifier to be a string literal." : undefined;
}
