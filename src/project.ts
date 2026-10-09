import path from "node:path";
import fg from "fast-glob";
import picomatch from "picomatch";
import { Project, type SourceFile } from "ts-morph";
import { isConfigFile, isInside, readConfigFile, realPath, relativePosix } from "./files.js";

export const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
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

export interface LeftOut {
  file: string;
  reason: "excluded" | "not-included";
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

function globFiles(dir: string, include: string[] | undefined, exclude: string[]): string[] {
  const patterns = include && include.length > 0 ? include : ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
  return fg.sync(patterns, { cwd: dir, absolute: true, ignore: exclude, followSymbolicLinks: false });
}

type Matcher = (file: string) => boolean;

/** Matches absolute paths under `dir` against globs relative to it; compiled once, same engine family as fast-glob. */
function globMatcher(dir: string, globs: string[] | undefined): Matcher | undefined {
  if (!globs || globs.length === 0) return undefined;
  const isMatch = picomatch(globs, { dot: true });
  return (file) => isMatch(relativePosix(dir, file));
}

/** Reads .env.example / .env.sample for host hints (values are only used if they look like URLs). */
export function readEnvHints(dir: string): Record<string, string> {
  const hints: Record<string, string> = {};
  for (const name of [".env.example", ".env.sample", ".env.template"]) {
    const text = readConfigFile(path.join(dir, name), dir);
    if (text === undefined) continue;
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*["']?([^"'#\s]*)/.exec(line);
      if (m && m[2] && /^https?:\/\//.test(m[2])) hints[m[1]!] = m[2];
    }
  }
  return hints;
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
  const unreadable = addFiles(project, dir, globFiles(dir, opts.include, exclude));
  if (tsconfig) {
    try {
      project.resolveSourceFileDependencies();
    } catch {
      // imported files only sharpen types: the files in scope are still scanned without them
    }
  }
  const files = selectFiles(project, dir, opts, exclude);
  return { project, files, envHints: readEnvHints(dir), leftOut: leftOutFiles(dir, opts, files, unreadable), unreadable };
}

/**
 * Files the default file set would scan but --exclude / --include removed; test files and build output are out of
 * scope, and an unreadable file is already reported as such.
 */
function leftOutFiles(dir: string, opts: LoadOptions, selected: SourceFile[], unreadable: Unreadable[]): LeftOut[] {
  if (!opts.include?.length && !opts.exclude?.length) return [];
  const kept = new Set<string>([...selected.map((sf) => sf.getFilePath() as string), ...unreadable.map((u) => u.path)]);
  const excluded = globMatcher(dir, opts.exclude);
  return globFiles(dir, undefined, DEFAULT_EXCLUDES)
    .filter((f) => !kept.has(f))
    .map((f) => ({ file: relativePosix(dir, f), reason: excluded?.(f) ? "excluded" : "not-included" }));
}
