import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { isInside, realPath } from "../../src/files.js";
import { LANGUAGE_IDS } from "../../src/lang/index.js";
import type { Language } from "../../src/report/schema.js";
import { normalizeFile, parseJson, readBounded } from "./read.js";

/** A repository of the evaluation: `<repos>/<name>`, scanned at `subdir` when there is one. */
export interface RepoSpec {
  name: string;
  /** The directory scanned: the repository, or its `subdir`. */
  dir: string;
  /** Repository-relative, `/` separated; empty for the whole repository. */
  subdir: string;
  language?: Language;
}

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

function isPlainName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && path.basename(name) === name && !name.includes("\\");
}

/** Directories right under `reposDir`, sorted; symlinks are left out (a repository is a checkout, not a link). */
function subdirectories(reposDir: string): RepoSpec[] {
  return readdirSync(reposDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort()
    .map((name) => ({ name, dir: path.join(reposDir, name), subdir: "" }));
}

function specOf(reposDir: string, raw: unknown): RepoSpec {
  const r = (raw ?? {}) as { name?: unknown; subdir?: unknown; language?: unknown };
  const name = typeof r.name === "string" ? r.name : "";
  if (!isPlainName(name)) throw new Error("manifest entry without a plain directory name");
  const subdir = typeof r.subdir === "string" ? normalizeFile(r.subdir).replace(/\/+$/, "") : "";
  const root = path.join(reposDir, name);
  const dir = subdir ? path.join(root, subdir) : root;
  // `subdir: "../other"` or a symlinked subdir must not leave the repository
  if (!isInside(path.resolve(root), path.resolve(dir)) || (existsSync(dir) && !isInside(realPath(root), realPath(dir)))) {
    throw new Error("manifest subdir leaves its repository");
  }
  const language = typeof r.language === "string" ? r.language : undefined;
  if (language !== undefined && !(LANGUAGE_IDS as string[]).includes(language)) throw new Error("manifest entry with an unknown language");
  return { name, dir, subdir, ...(language ? { language: language as Language } : {}) };
}

/**
 * The repositories to evaluate: every directory under `reposDir`, or the entries of a manifest shaped like
 * `eval/repos.json` (`name`, optional `subdir` and `language`; `url` is not used).
 */
export function listRepos(dir: string, manifest?: string): RepoSpec[] {
  // absolute: a repository named `-x` must never reach the scan command line as an option
  const reposDir = path.resolve(dir);
  if (!manifest) return subdirectories(reposDir);
  const parsed = parseJson(readBounded(manifest, MAX_MANIFEST_BYTES), "the manifest");
  if (!Array.isArray(parsed)) throw new Error("the manifest is not a JSON array");
  const specs = parsed.map((raw) => specOf(reposDir, raw));
  if (new Set(specs.map((s) => s.name)).size !== specs.length) throw new Error("the manifest names a repository twice");
  return specs;
}
