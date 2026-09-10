import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { Project, type SourceFile } from "ts-morph";

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

export interface Loaded {
  project: Project;
  files: SourceFile[];
  envHints: Record<string, string>;
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

function globFiles(dir: string, include: string[] | undefined, exclude: string[]): string[] {
  const patterns = include && include.length > 0 ? include : ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
  return fg.sync(patterns, { cwd: dir, absolute: true, ignore: exclude, followSymbolicLinks: false });
}

function matchesAny(file: string, dir: string, globs: string[]): boolean {
  if (globs.length === 0) return false;
  const rel = path.relative(dir, file).split(path.sep).join("/");
  return globs.some((g) => globToRegExp(g).test(rel));
}

export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
        i += glob[i + 2] === "/" ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (".+^${}()|[]\\".includes(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

/** Reads .env.example / .env.sample for host hints (values are only used if they look like URLs). */
export function readEnvHints(dir: string): Record<string, string> {
  const hints: Record<string, string> = {};
  for (const name of [".env.example", ".env.sample", ".env.template"]) {
    const file = path.join(dir, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*["']?([^"'#\s]*)/.exec(line);
      if (m && m[2] && /^https?:\/\//.test(m[2])) hints[m[1]!] = m[2];
    }
  }
  return hints;
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
    project.addSourceFilesAtPaths(globFiles(dir, opts.include, exclude));
    project.resolveSourceFileDependencies();
  } else {
    project = new Project({
      compilerOptions: { skipLibCheck: true, noEmit: true, allowJs: false, strict: false, esModuleInterop: true },
    });
    project.addSourceFilesAtPaths(globFiles(dir, opts.include, exclude));
  }
  return { project, files: selectFiles(project, dir, opts, exclude), envHints: readEnvHints(dir) };
}
