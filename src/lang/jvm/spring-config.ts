import path from "node:path";
import { readConfigFile } from "../../files.js";
import type { Expr } from "../ir/model.js";
import { upwards } from "./manifests.js";
import { springPlaceholders } from "./placeholders.js";

/**
 * Spring Boot configuration (`src/main/resources/application.properties`, `application.yml`): the properties a
 * module's code reads without naming them (Spring AI's `spring.ai.openai.chat.options.model`). Only the default
 * profile: YAML documents activated by a profile and `application-<profile>.*` files are left out. The files are
 * hostile input like every config file: read with `readConfigFile`, through linear line-by-line patterns, bounded.
 */

const FILES = ["application.yml", "application.yaml", "application.properties"];
/** Lines read per file; a longer file is generated or not configuration a module writes by hand. */
const MAX_LINES = 20_000;
const MAX_VALUE = 2_000;

type Props = Map<string, string>;

/** Spring's relaxed binding: `base-url`, `baseUrl` and `base_url` are one property. */
export const relaxedKey = (key: string): string => key.toLowerCase().replace(/[-_]/g, "");

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1);
  // a trailing comment (`model: gpt-4o # the default`) is not the value
  return t.replace(/\s+#.*$/, "");
}

function put(props: Props, key: string, value: string): void {
  if (value.length <= MAX_VALUE && key.length <= 300) props.set(relaxedKey(key), value);
}

export function parseProperties(text: string): Props {
  const props: Props = new Map();
  for (const line of text.split(/\r?\n/, MAX_LINES)) {
    const m = /^\s*([A-Za-z0-9_.[\]-]+)\s*[=:]\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#") && !line.trimStart().startsWith("!")) put(props, m[1]!, m[2]!);
  }
  return props;
}

/** One YAML document: nested block mappings with scalar values (lists, block scalars and flow collections are left out). */
function parseYamlDocument(lines: string[]): Props {
  const props: Props = new Map();
  const stack: { indent: number; key: string }[] = [];
  let skipBelow = -1;
  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    if (body === "" || body.startsWith("#")) continue;
    if (skipBelow >= 0 && indent > skipBelow) continue;
    skipBelow = -1;
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const m = /^("[^"]*"|'[^']*'|[^\s:#"'{[-][^:#]*?)\s*:(?:\s+(.*))?$/.exec(body);
    if (!m) {
      // a list item or anything else: what is nested under it is not a mapping of this document
      skipBelow = indent;
      continue;
    }
    const key = [...stack.map((s) => s.key), unquote(m[1]!)].join(".");
    const value = m[2]?.trim() ?? "";
    if (value === "" || value.startsWith("#")) stack.push({ indent, key: unquote(m[1]!) });
    else if (/^[|>[{&*!]/.test(value)) skipBelow = indent;
    else put(props, key, unquote(value));
  }
  return props;
}

/** A document a profile activates (`spring.config.activate.on-profile`, `spring.profiles`) is not the default one. */
const forProfile = (doc: Props): boolean => doc.has(relaxedKey("spring.config.activate.on-profile")) || doc.has(relaxedKey("spring.profiles"));

export function parseYaml(text: string): Props {
  const props: Props = new Map();
  let doc: string[] = [];
  const flush = (): void => {
    const parsed = parseYamlDocument(doc);
    if (!forProfile(parsed)) for (const [k, v] of parsed) props.set(k, v);
    doc = [];
  };
  for (const line of text.split(/\r?\n/, MAX_LINES)) {
    if (/^---\s*$/.test(line)) flush();
    else doc.push(line);
  }
  flush();
  return props;
}

const cache = new Map<string, Props | null>();

/** The properties of `dir/src/main/resources`, `.properties` over YAML as Spring loads them; null when it has none. */
function propsIn(dir: string, rootDir: string): Props | null {
  const key = `${rootDir}\0${dir}`;
  if (cache.has(key)) return cache.get(key)!;
  let out: Props | null = null;
  for (const name of FILES) {
    const text = readConfigFile(path.join(dir, "src", "main", "resources", name), rootDir);
    if (text === undefined) continue;
    out ??= new Map();
    for (const [k, v] of name.endsWith(".properties") ? parseProperties(text) : parseYaml(text)) out.set(k, v);
  }
  cache.set(key, out);
  return out;
}

/** The raw value of a property for a source file: the resources of the nearest module that has some. */
export function springPropertyText(file: string, rootDir: string, key: string): string | undefined {
  for (const dir of upwards(path.dirname(file), rootDir)) {
    const props = propsIn(dir, rootDir);
    if (props) return props.get(relaxedKey(key));
  }
  return undefined;
}

/**
 * A property as a configuration read: the property named `key` with the file's value as its default (`${X:d}` in
 * the value is the environment variable it names), as `@Value("${key:default}")` reads.
 */
export function springProperty(file: string, rootDir: string, key: string, edit?: (text: string) => string): Expr | undefined {
  const text = springPropertyText(file, rootDir, key);
  if (text === undefined || text === "") return undefined;
  const value = edit ? edit(text) : text;
  return value.includes("${") ? springPlaceholders(value) : { k: "env", name: key, fallback: { k: "str", v: value } };
}
