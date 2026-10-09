import path from "node:path";
import { readConfigFile } from "./files.js";

export interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** How far above a source file the nearest package.json is looked for. */
const MAX_LEVELS = 8;

function load(dir: string, root: string): PackageJson {
  const text = readConfigFile(path.join(dir, "package.json"), root);
  if (text === undefined) return {};
  try {
    const json = JSON.parse(text) as unknown;
    return json && typeof json === "object" ? json : {};
  } catch {
    // an unreadable package.json declares nothing
    return {};
  }
}

/** Reads each directory's package.json under `root` once per scan; a missing, unreadable or outside file reads as `{}`. */
export class PackageJsonReader {
  private readonly cache = new Map<string, PackageJson>();

  constructor(private readonly root: string) {}

  read(dir: string): PackageJson {
    let pkg = this.cache.get(dir);
    if (!pkg) {
      pkg = load(dir, this.root);
      this.cache.set(dir, pkg);
    }
    return pkg;
  }

  /** Version range of `name` in the nearest package.json above `file`, up to the root (dependencies win over devDependencies). */
  versionOf(file: string, name: string): string | undefined {
    const rootDir = this.root;
    const rangeIn = (dir: string): string | undefined => {
      const pkg = this.read(dir);
      return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
    };
    let dir = path.dirname(file);
    for (let i = 0; i < MAX_LEVELS; i++) {
      const v = rangeIn(dir);
      if (v) return v;
      if (dir === rootDir || path.dirname(dir) === dir) break;
      dir = path.dirname(dir);
    }
    return rangeIn(rootDir);
  }
}
