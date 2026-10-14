import path from "node:path";
import * as tsMorph from "ts-morph";
import { Project, ts, type FileSystemHost, type RuntimeDirEntry } from "ts-morph";
import { isInside, realPath } from "./files.js";

let realHost: FileSystemHost | undefined;

/** ts-morph's own host over the disk (not exported by ts-morph): the one a project gets when given none. */
function diskHost(): FileSystemHost {
  realHost ??= new Project({ skipLoadingLibFiles: true }).getFileSystem();
  return realHost;
}

/**
 * What ts-morph expects of a host for a missing file: a program reads the files it asks for without checking first, and
 * only this error means "no such file". Exported at runtime, not in ts-morph's types.
 */
const { FileNotFoundError } = tsMorph as unknown as { FileNotFoundError: new (path: string) => Error };

function readOnly(..._args: unknown[]): never {
  throw new Error("the scanned directory is read-only");
}

/**
 * The disk as the checker sees it during a scan: only `root` exists (#112). Module resolution walks up every parent
 * directory for `node_modules` and `node_modules/@types`, so a package installed above the checkout (`~/node_modules`)
 * typed calls differently depending on where the repository was cloned, and a repository could import a file from
 * anywhere on disk (`../../../home/user/x.ts`) into its types. A path is inside when it is, and stays once symlinks
 * are resolved. Lib files are not on this disk: ts-morph serves them from memory. The tsconfig, which the scan may
 * find above `root`, is read before (`scopeOf`), with the disk.
 */
export class BoundedFileSystem implements FileSystemHost {
  private readonly root: string;
  private readonly realRoot: string;

  constructor(
    root: string,
    private readonly disk: FileSystemHost = diskHost(),
  ) {
    this.root = path.resolve(root);
    this.realRoot = realPath(this.root);
  }

  /** `p` and, when it exists, what it points to are inside the root. */
  contains(p: string): boolean {
    const abs = path.resolve(p);
    return isInside(this.root, abs) && isInside(this.realRoot, realPath(abs));
  }

  isCaseSensitive(): boolean {
    return this.disk.isCaseSensitive();
  }

  readDirSync(dirPath: string): RuntimeDirEntry[] {
    if (!this.contains(dirPath)) return [];
    return this.disk.readDirSync(dirPath).filter((e) => !e.isSymlink || this.contains(e.name));
  }

  readFile(filePath: string, encoding?: string): Promise<string> {
    return this.contains(filePath) ? this.disk.readFile(filePath, encoding) : Promise.reject(new FileNotFoundError(filePath));
  }

  readFileSync(filePath: string, encoding?: string): string {
    if (!this.contains(filePath)) throw new FileNotFoundError(filePath);
    return this.disk.readFileSync(filePath, encoding);
  }

  fileExists(filePath: string): Promise<boolean> {
    return Promise.resolve(this.fileExistsSync(filePath));
  }

  fileExistsSync(filePath: string): boolean {
    return this.disk.fileExistsSync(filePath) && this.contains(filePath);
  }

  directoryExists(dirPath: string): Promise<boolean> {
    return Promise.resolve(this.directoryExistsSync(dirPath));
  }

  directoryExistsSync(dirPath: string): boolean {
    return this.disk.directoryExistsSync(dirPath) && this.contains(dirPath);
  }

  realpathSync(p: string): string {
    return this.contains(p) ? this.disk.realpathSync(p) : p;
  }

  /** The root: what TypeScript resolves relative paths and, without a tsconfig, `node_modules/@types` from. */
  getCurrentDirectory(): string {
    return this.root.split(path.sep).join("/");
  }

  glob(): Promise<string[]> {
    return Promise.resolve([]);
  }

  globSync(): string[] {
    return [];
  }

  delete = readOnly;
  deleteSync = readOnly;
  writeFile = readOnly;
  writeFileSync = readOnly;
  mkdir = readOnly;
  mkdirSync = readOnly;
  move = readOnly;
  moveSync = readOnly;
  copy = readOnly;
  copySync = readOnly;
}

/** The same bound for TypeScript's own module resolution (the file graph that splits a scan into batches). */
export function boundedResolutionHost(root: string): ts.ModuleResolutionHost {
  const fs = new BoundedFileSystem(root);
  return {
    fileExists: (f) => fs.fileExistsSync(f),
    directoryExists: (d) => fs.directoryExistsSync(d),
    readFile: (f) => (fs.contains(f) ? ts.sys.readFile(f) : undefined),
    realpath: (p) => fs.realpathSync(p),
    getCurrentDirectory: () => fs.getCurrentDirectory(),
    getDirectories: (d) => (fs.contains(d) ? ts.sys.getDirectories(d) : []),
  };
}
