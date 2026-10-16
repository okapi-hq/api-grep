import path from "node:path";
import { Project, type ts } from "ts-morph";
import { BoundedFileSystem } from "./bounded-fs.js";
import { isConfigFile } from "./files.js";

const CONFIG_NAMES = ["tsconfig.json", "jsconfig.json"];

/**
 * Path aliases of the packages of a monorepo. A scan reads one tsconfig, the one nearest the scanned directory, but each
 * package of a monorepo (`apps/web`, `apps/server`) usually declares its own `paths` (`@/*` -> `./src/*`): an import of
 * `@/lib/db` there only resolves with that package's aliases. A file whose nearest tsconfig (or jsconfig) is not the
 * scan's resolves its imports with the scan's options plus that tsconfig's `paths` and `baseUrl`; everything else
 * (module kind, resolution mode) stays the scan's. The tsconfig and what it extends are read inside `bound`.
 */
export class NestedAliases {
  private readonly dirs = new Map<string, string | null>();
  private readonly configs = new Map<string, ts.CompilerOptions | null>();

  constructor(
    private readonly base: ts.CompilerOptions,
    private readonly bound: string,
    private readonly main: string | undefined,
  ) {}

  /** The options to resolve the imports of `file` with when a nested tsconfig adds aliases, else undefined (the scan's). */
  optionsFor(file: string): ts.CompilerOptions | undefined {
    if (file.split(/[\\/]/).includes("node_modules")) return undefined;
    const config = this.nearest(path.dirname(path.resolve(file)));
    if (!config || config === this.main) return undefined;
    let out = this.configs.get(config);
    if (out === undefined) this.configs.set(config, (out = this.read(config)));
    return out ?? undefined;
  }

  /** The nearest tsconfig or jsconfig from `dir` up to the bound, memoized per directory. */
  private nearest(dir: string): string | undefined {
    const walked: string[] = [];
    let found: string | null = null;
    for (let cur = dir; ; cur = path.dirname(cur)) {
      const known = this.dirs.get(cur);
      if (known !== undefined) {
        found = known;
        break;
      }
      walked.push(cur);
      const file = CONFIG_NAMES.map((name) => path.join(cur, name)).find(isConfigFile);
      if (file) {
        found = file;
        break;
      }
      if (cur === this.bound || path.dirname(cur) === cur || !isWithin(this.bound, cur)) break;
    }
    for (const d of walked) this.dirs.set(d, found);
    return found ?? undefined;
  }

  private read(config: string): ts.CompilerOptions | null {
    try {
      const fileSystem = new BoundedFileSystem(this.bound);
      const own = new Project({ fileSystem, tsConfigFilePath: config, skipAddingFilesFromTsConfig: true }).getCompilerOptions();
      if (!own.paths && own.baseUrl === undefined) return null;
      return { ...this.base, paths: own.paths, baseUrl: own.baseUrl, pathsBasePath: own.pathsBasePath };
    } catch {
      // an unreadable tsconfig adds nothing: the scan's options still resolve relative imports
      return null;
    }
  }
}

function isWithin(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
