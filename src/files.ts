import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

/** Config files the scan reads itself (package.json, .env.example, tsconfig.json) are small: anything larger is not one. */
const MAX_CONFIG_BYTES = 4 * 1024 * 1024;

/** `file` relative to `root`, `/` separated on every platform (the form reports use). */
export function relativePosix(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

/** `p` is `root` or below it (`/repo2` is not inside `/repo`). */
export function isInside(root: string, p: string): boolean {
  return p === root || p.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);
}

/** Path with symlinks resolved; the path itself when it cannot be resolved. */
export function realPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * A regular file of the scanned repository read as text, or undefined. A repository can commit a symlink named
 * `package.json` that points to `/dev/zero` or a huge file: reading it would never end, so only small regular files are
 * read. With `root`, the file must also stay inside it once symlinks are resolved (`.env.example -> ~/.env` is not read).
 */
export function readConfigFile(file: string, root?: string): string | undefined {
  try {
    if (root !== undefined && !isInside(realPath(root), realPath(file))) return undefined;
    return isConfigFile(file) ? readFileSync(file, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

/** A regular file small enough to be a config file (see `readConfigFile`). */
export function isConfigFile(file: string): boolean {
  const st = statSync(file, { throwIfNoEntry: false });
  return !!st?.isFile() && st.size <= MAX_CONFIG_BYTES;
}
