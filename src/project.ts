import { existsSync } from "node:fs";
import path from "node:path";
import { Project, ts, type SourceFile } from "ts-morph";
import { languageFiles, leftOutFiles, matchesAny, readEnvHints, SHARED_EXCLUDES, type LeftOut } from "./lang/files.js";

export { globToRegExp, readEnvHints, type LeftOut } from "./lang/files.js";

export const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

export const DEFAULT_EXCLUDES = [
  ...SHARED_EXCLUDES,
  "**/.next/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/__mocks__/**",
  "**/__tests__/**",
  "**/*.d.ts",
];

export interface LoadOptions {
  dir: string;
  tsconfig?: string;
  include?: string[];
  exclude?: string[];
}

export interface Loaded {
  project: Project;
  files: SourceFile[];
  envHints: Record<string, string>;
  /** Source files in scope that --exclude / --include left out (paths relative to the scanned directory). */
  leftOut: LeftOut[];
}

function findTsconfig(dir: string): string | undefined {
  let cur = path.resolve(dir);
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(cur, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return undefined;
}

/** TypeScript files in scope (an `--include` glob only ever selects TypeScript files here). */
export function tsFiles(dir: string, include: string[] | undefined, exclude: string[] = []): string[] {
  return languageFiles(dir, TS_EXTENSIONS, include, [...DEFAULT_EXCLUDES, ...exclude]);
}

function selectFiles(project: Project, dir: string, opts: LoadOptions, exclude: string[]): SourceFile[] {
  const abs = path.resolve(dir);
  return project.getSourceFiles().filter((sf) => {
    const fp = sf.getFilePath();
    if (!fp.startsWith(abs)) return false;
    if (sf.isDeclarationFile() || sf.isFromExternalLibrary()) return false;
    if (matchesAny(fp, abs, exclude)) return false;
    if (opts.include && opts.include.length > 0 && !matchesAny(fp, abs, opts.include)) return false;
    return true;
  });
}

/** One by one: `addSourceFilesAtPaths` reads paths as globs, so a directory named `app [beta]` matched nothing. */
function addFiles(project: Project, files: string[]): void {
  for (const f of files) project.addSourceFileAtPath(f);
}

export function loadProject(opts: LoadOptions): Loaded {
  const dir = path.resolve(opts.dir);
  const exclude = [...DEFAULT_EXCLUDES, ...(opts.exclude ?? [])];
  const tsconfig = opts.tsconfig ? path.resolve(opts.tsconfig) : findTsconfig(dir);
  let project: Project;
  if (tsconfig) {
    project = new Project({
      tsConfigFilePath: tsconfig,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: { skipLibCheck: true, noEmit: true },
    });
    addFiles(project, tsFiles(dir, opts.include, opts.exclude));
    project.resolveSourceFileDependencies();
  } else {
    project = new Project({
      compilerOptions: { skipLibCheck: true, noEmit: true, allowJs: false, strict: false, esModuleInterop: true },
    });
    addFiles(project, tsFiles(dir, opts.include, opts.exclude));
  }
  const files = selectFiles(project, dir, opts, exclude);
  const kept = new Set(files.map((sf) => sf.getFilePath() as string));
  const leftOut = leftOutFiles({ dir, include: opts.include, exclude: opts.exclude }, TS_EXTENSIONS, DEFAULT_EXCLUDES, kept);
  return { project, files, envHints: readEnvHints(dir), leftOut };
}

/** Why a file cannot be read reliably: a syntax error, or an import whose module specifier is not a string literal. */
export function unreadable(sf: SourceFile): string | undefined {
  const syntax = sf.getProject().getProgram().compilerObject.getSyntacticDiagnostics(sf.compilerNode)[0];
  if (syntax) return ts.flattenDiagnosticMessageText(syntax.messageText, " ");
  const decls = [...sf.getImportDeclarations(), ...sf.getExportDeclarations()];
  const bad = decls.some((d) => d.compilerNode.moduleSpecifier !== undefined && !ts.isStringLiteral(d.compilerNode.moduleSpecifier));
  return bad ? "Expected the module specifier to be a string literal." : undefined;
}
