import path from "node:path";
import { Project, type SourceFile } from "ts-morph";
import { isConfigFile, isInside, realPath, relativePosix } from "./files.js";
import { globMatcher, languageFiles, leftOutFiles, readEnvHints, SHARED_EXCLUDES, type LeftOut } from "./lang/files.js";

export { readEnvHints, type LeftOut } from "./lang/files.js";

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

function findTsconfig(dir: string): string | undefined {
  let cur = path.resolve(dir);
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(cur, "tsconfig.json");
    if (isConfigFile(candidate)) return candidate;
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

/** Files under `dir`, also once symlinks are resolved: a committed symlink cannot pull in a file from elsewhere on disk. */
function selectFiles(project: Project, dir: string, opts: LoadOptions, exclude: string[]): SourceFile[] {
  const excluded = globMatcher(dir, exclude);
  const included = globMatcher(dir, opts.include);
  const realDir = realPath(dir);
  return project.getSourceFiles().filter((sf) => {
    const fp = sf.getFilePath();
    if (!isInside(dir, fp)) return false;
    if (sf.isDeclarationFile() || sf.isFromExternalLibrary()) return false;
    if (excluded?.(fp) || (included && !included(fp))) return false;
    return isInside(realDir, realPath(fp));
  });
}

/** One by one: `addSourceFilesAtPaths` reads paths as globs, so a directory named `app [beta]` matched nothing. */
function addFiles(project: Project, dir: string, files: string[]): Unreadable[] {
  const unreadable: Unreadable[] = [];
  for (const f of files) {
    try {
      project.addSourceFileAtPath(f);
    } catch (err) {
      unreadable.push({ path: f, file: relativePosix(dir, f), detail: (err instanceof Error ? err.message : String(err)).split("\n")[0]! });
    }
  }
  return unreadable;
}

function createProject(tsconfig: string | undefined): Project {
  if (!tsconfig) return new Project({ compilerOptions: { skipLibCheck: true, noEmit: true, allowJs: false, strict: false, esModuleInterop: true } });
  return new Project({ tsConfigFilePath: tsconfig, skipAddingFilesFromTsConfig: true, compilerOptions: { skipLibCheck: true, noEmit: true } });
}

function tsconfigFor(dir: string, explicit: string | undefined): string | undefined {
  if (!explicit) return findTsconfig(dir);
  const file = path.resolve(explicit);
  if (!isConfigFile(file)) throw new Error(`tsconfig not found: ${file}`);
  return file;
}

export function loadProject(opts: LoadOptions): Loaded {
  const dir = path.resolve(opts.dir);
  const exclude = [...DEFAULT_EXCLUDES, ...(opts.exclude ?? [])];
  const tsconfig = tsconfigFor(dir, opts.tsconfig);
  const project = createProject(tsconfig);
  const unreadable = addFiles(project, dir, tsFiles(dir, opts.include, opts.exclude));
  if (tsconfig) {
    try {
      project.resolveSourceFileDependencies();
    } catch {
      // imported files only sharpen types: the files in scope are still scanned without them
    }
  }
  const files = selectFiles(project, dir, opts, exclude);
  // an unreadable file is already reported as such
  const kept = new Set<string>([...files.map((sf) => sf.getFilePath() as string), ...unreadable.map((u) => u.path)]);
  const leftOut = leftOutFiles({ dir, include: opts.include, exclude: opts.exclude }, TS_EXTENSIONS, DEFAULT_EXCLUDES, kept);
  return { project, files, envHints: readEnvHints(dir), leftOut, unreadable };
}
