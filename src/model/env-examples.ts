import path from "node:path";
import fg from "fast-glob";
import { isInside, readConfigFile, realPath, relativePosix } from "../files.js";
import { SHARED_EXCLUDES } from "../lang/files.js";
import type { Call } from "../report/schema.js";

/**
 * The values a repository's example env files give its variables (`.env.example`, `.env.sample`, `.env.template`,
 * `.env.dist`, the same with a middle part such as `.env.local.example`, and `.env-example`, `env.example`,
 * `example.env` spellings), by directory. A call that reads its model from a variable gets the value of the example file
 * nearest it (its directory, then each parent) as `model.envExample` and among its values, with the source
 * `env_example`: what the project documents the variable to hold. A commented-out assignment (`# MODEL=gpt-4o`, an
 * optional setting) documents it too, after any assignment that is not commented out. Only a value that can be a model
 * name is kept.
 */

const PATTERNS = [
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.dist",
  ".env.*.example",
  ".env.*.sample",
  ".env.*.template",
  ".env-example",
  ".env-sample",
  ".env-template",
  "env.example",
  "example.env",
].map((name) => `**/${name}`);
/** Enough for a monorepo; a repository listing more is not worth reading them all. */
const MAX_FILES = 200;
const LINE = /^\s*(#\s*)?(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s#]*))/;
/** A value that can be a model name: no space or markup, a sane length. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;
/** A value that only stands in for one: `your-model-here`, `changeme`, `xxx`, `my-deployment`, `mock-model`. */
const PLACEHOLDER = /your|change-?me|replace|placeholder|todo|^x+$|^my[-_]|example|^(mock|fake|dummy|stub)([-_.]|$)/i;

/** A variable's documented value and the file (relative, POSIX) documenting it. */
export interface EnvExample {
  value: string;
  file: string;
  /** Written as a comment (`# MODEL=gpt-4o`). */
  commented?: boolean;
}

/** Directory (relative, POSIX, `""` for the root) to variable to value. */
export type EnvExamples = Map<string, Map<string, EnvExample>>;

/** Lines read per file: an example env file is short. */
const MAX_LINES = 5_000;

function parse(text: string, file: string): Map<string, EnvExample> {
  const vars = new Map<string, EnvExample>();
  // a variable commented out with several values (one per provider a section documents) documents none of them
  const commented = new Map<string, Set<string>>();
  for (const line of text.split(/\r?\n/, MAX_LINES)) {
    if (line.length > 1_000) continue;
    const m = LINE.exec(line);
    const value = m && (m[3] ?? m[4] ?? m[5]);
    if (!m || !value) continue;
    if (m[1]) commented.set(m[2]!, (commented.get(m[2]!) ?? new Set()).add(value));
    if (!NAME.test(value) || PLACEHOLDER.test(value)) continue;
    const prev = vars.get(m[2]!);
    if (!prev || (prev.commented && !m[1])) vars.set(m[2]!, { value, file, ...(m[1] ? { commented: true } : {}) });
  }
  for (const [name, found] of vars) if (found.commented && (commented.get(name)?.size ?? 0) > 1) vars.delete(name);
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
    const rel = relativePosix(dir, file);
    const at = path.posix.dirname(rel);
    const vars = examples.get(at === "." ? "" : at) ?? new Map<string, EnvExample>();
    for (const [name, found] of parse(text, rel)) {
      const prev = vars.get(name);
      if (!prev || (prev.commented && !found.commented)) vars.set(name, found);
    }
    examples.set(at === "." ? "" : at, vars);
  }
  return examples;
}

/** The value the example file nearest `file` (relative, POSIX) gives `name`. */
export function exampleValue(examples: EnvExamples, file: string, name: string): EnvExample | undefined {
  for (let at = path.posix.dirname(file); ; at = path.posix.dirname(at)) {
    const key = at === "." ? "" : at;
    const value = examples.get(key)?.get(name);
    if (value !== undefined) return value;
    if (key === "") return undefined;
  }
}

/** The calls, each model read from a variable with the value its nearest example file documents among its values. */
export function withEnvExamples(calls: Call[], examples: EnvExamples): Call[] {
  if (examples.size === 0) return calls;
  return calls.map((c) => {
    const env = c.model?.env;
    const found = env ? exampleValue(examples, c.location.file, env) : undefined;
    if (!found) return c;
    const model = c.model!;
    if (model.values.includes(found.value)) return { ...c, model: { ...model, envExample: found.value } };
    const source = { value: found.value, from: "env_example" as const, file: found.file };
    return { ...c, model: { ...model, values: [...model.values, found.value], envExample: found.value, sources: [...(model.sources ?? []), source] } };
  });
}
