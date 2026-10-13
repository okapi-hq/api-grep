import path from "node:path";
import fg from "fast-glob";
import { isInside, readConfigFile, realPath, relativePosix } from "../files.js";
import { SHARED_EXCLUDES } from "../lang/files.js";
import type { Call } from "../report/schema.js";

/**
 * The values a repository's example env files give its variables (`.env.example`, `.env.sample`, `.env.template`,
 * `.env.dist`, the same with a middle part such as `.env.local.example`), by directory. A call that reads its model from
 * a variable gets the value of the example file nearest it (its directory, then each parent) as `model.envExample`:
 * what the project documents the variable to hold, not a value the code gives, so it stays out of `values`. Only a value
 * that can be a model name is kept.
 */

const PATTERNS = [".env.example", ".env.sample", ".env.template", ".env.dist", ".env.*.example", ".env.*.sample", ".env.*.template"].map(
  (name) => `**/${name}`,
);
/** Enough for a monorepo; a repository listing more is not worth reading them all. */
const MAX_FILES = 200;
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s#]*))/;
/** A value that can be a model name: no space or markup, a sane length. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;
/** A value that only stands in for one: `your-model-here`, `changeme`, `xxx`. */
const PLACEHOLDER = /your|change-?me|replace|placeholder|todo|^x+$/i;

/** Directory (relative, POSIX, `""` for the root) to variable to value. */
export type EnvExamples = Map<string, Map<string, string>>;

function parse(text: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line);
    const value = m && (m[2] ?? m[3] ?? m[4]);
    if (m && value && NAME.test(value) && !PLACEHOLDER.test(value) && !vars.has(m[1]!)) vars.set(m[1]!, value);
  }
  return vars;
}

/** Every example env file of the repository, read once; files outside it (through a symlink) are not. */
export function readEnvExamples(dir: string): EnvExamples {
  const realDir = realPath(dir);
  const files = fg
    .sync(PATTERNS, { cwd: dir, absolute: true, dot: true, ignore: SHARED_EXCLUDES, followSymbolicLinks: false })
    .filter((f) => isInside(realDir, realPath(f)))
    .sort()
    .slice(0, MAX_FILES);
  const examples: EnvExamples = new Map();
  for (const file of files) {
    const text = readConfigFile(file, dir);
    if (text === undefined) continue;
    const at = path.posix.dirname(relativePosix(dir, file));
    const vars = examples.get(at === "." ? "" : at) ?? new Map<string, string>();
    for (const [name, value] of parse(text)) if (!vars.has(name)) vars.set(name, value);
    examples.set(at === "." ? "" : at, vars);
  }
  return examples;
}

/** The value the example file nearest `file` (relative, POSIX) gives `name`. */
export function exampleValue(examples: EnvExamples, file: string, name: string): string | undefined {
  for (let at = path.posix.dirname(file); ; at = path.posix.dirname(at)) {
    const key = at === "." ? "" : at;
    const value = examples.get(key)?.get(name);
    if (value !== undefined) return value;
    if (key === "") return undefined;
  }
}

/** The calls, each model read from a variable with the value its nearest example file documents. */
export function withEnvExamples(calls: Call[], examples: EnvExamples): Call[] {
  if (examples.size === 0) return calls;
  return calls.map((c) => {
    const env = c.model?.env;
    const value = env ? exampleValue(examples, c.location.file, env) : undefined;
    return value ? { ...c, model: { ...c.model!, envExample: value } } : c;
  });
}
