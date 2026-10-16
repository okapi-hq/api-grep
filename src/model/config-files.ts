import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { isInside, readConfigFile, realPath, relativePosix } from "../files.js";
import { yamlData, type ConfigValue } from "./yaml-data.js";

/**
 * Config files the code loads by a literal path (`yaml.safe_load(open("config.yaml"))`, `json.load(open(...))`,
 * `import config from "./config.json"`): read from the scanned repository like any config file it reads
 * (`readConfigFile`: small regular files, symlinks kept inside), JSON, YAML (block mappings) or TOML. A relative path
 * is taken from the loading file's directory, then from the scanned directory: the working directory a program runs
 * in is not known, and those are where a repository keeps the file it means. Never above the scanned directory.
 */

export type { ConfigValue } from "./yaml-data.js";

export interface LoadedConfig {
  /** Relative to the scanned directory, `/` separated. */
  file: string;
  data: ConfigValue;
}

const PARSERS: Record<string, (text: string) => unknown> = {
  ".json": (t) => JSON.parse(t) as unknown,
  ".yaml": yamlData,
  ".yml": yamlData,
  ".toml": (t) => parseToml(t),
};

/** Read files kept per process: a scan loads the same config from many places. Bounded, as the server scans many repositories. */
const cache = new Map<string, LoadedConfig | null>();
const MAX_CACHED = 256;

/** Whether a literal path names a config file this reads (by its extension). */
export const isConfigPath = (p: string): boolean => path.extname(p).toLowerCase() in PARSERS;

function read(file: string, rootDir: string): LoadedConfig | undefined {
  const key = `${rootDir}\0${file}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit ?? undefined;
  const text = readConfigFile(file, rootDir);
  let loaded: LoadedConfig | null = null;
  if (text !== undefined) {
    try {
      const data = PARSERS[path.extname(file).toLowerCase()]!(text);
      if (data !== null && typeof data === "object") loaded = { file: relativePosix(rootDir, file), data: data as ConfigValue };
    } catch {
      // not the format its name says: nothing read
    }
  }
  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(key, loaded);
  return loaded ?? undefined;
}

/** The config file `literal` names, as loaded from `fromFile` (absolute) in a scan of `rootDir`. */
export function loadConfig(literal: string, fromFile: string, rootDir: string): LoadedConfig | undefined {
  if (!isConfigPath(literal) || path.isAbsolute(literal) || literal.startsWith("~") || literal.length > 300) return undefined;
  const root = realPath(rootDir);
  for (const base of [path.dirname(fromFile), rootDir]) {
    const file = path.resolve(base, literal);
    if (!isInside(root, realPath(file))) continue;
    const found = read(file, rootDir);
    if (found) return found;
  }
  return undefined;
}

/** `${OPENAI_MODEL:gpt-4o}`, `{{ model }}`: a value the program or a template fills in, not the value it gets. */
export const isInterpolated = (v: string): boolean => /\$\{|\{\{|%\(/.test(v);

/** The value under a key path of a loaded file (`["llm", "model"]`). */
export function configAt(data: ConfigValue, keys: string[]): ConfigValue | undefined {
  let at: ConfigValue | undefined = data;
  for (const k of keys) {
    if (at === null || typeof at !== "object" || Array.isArray(at) || !Object.prototype.hasOwnProperty.call(at, k)) return undefined;
    at = at[k];
  }
  return at;
}
