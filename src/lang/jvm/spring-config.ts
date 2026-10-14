import path from "node:path";
import { readConfigFile } from "../../files.js";
import type { Expr } from "../ir/model.js";
import { upwards } from "./manifests.js";
import { springPlaceholders } from "./placeholders.js";
import { propertiesDocs, relaxedKey, yamlDocs, type ConfigDoc, type Props } from "./spring-config-parse.js";

export { parseProperties, parseYaml, relaxedKey } from "./spring-config-parse.js";

/**
 * Spring Boot configuration (`src/main/resources/application.properties`, `application.yml`): the properties a
 * module's code reads without naming them (Spring AI's `spring.ai.openai.chat.options.model`). The default documents,
 * then the files `spring.config.import` names on the classpath, then the profiles `spring.profiles.active` names (their
 * documents and `application-<profile>.*` files), each over the ones before, as Spring loads them. A config server
 * and files outside the module's resources are not read. The files are hostile input like every config file: read with
 * `readConfigFile`, bounded (`spring-config-parse.ts`).
 */

const EXTENSIONS = [".yml", ".yaml", ".properties"];
const MAX_PROFILES = 4;
const MAX_IMPORTS = 8;

/** The documents of one file, undefined when it does not exist. */
function docsOf(file: string, rootDir: string): ConfigDoc[] | undefined {
  const text = readConfigFile(file, rootDir);
  if (text === undefined) return undefined;
  return file.endsWith(".properties") ? propertiesDocs(text) : yamlDocs(text);
}

/** `a, b`, `${PROFILES:dev}` (its default): the names a property lists; none for a placeholder without a default. */
function listed(value: string | undefined): string[] {
  const out: string[] = [];
  for (const item of (value ?? "").split(",").map((s) => s.trim())) {
    const v = /^\$\{[\w.-]+:([^}]*)\}$/.exec(item)?.[1] ?? item;
    if (v !== "" && !v.includes("${")) out.push(v);
  }
  return out;
}

/** `classpath:extra.yml`, `optional:classpath:/config/ai.properties`: the resource file an import names. */
function importedFile(resources: string, spec: string): string | undefined {
  const m = /^(?:optional:)?classpath:\/?([\w./-]+)$/.exec(spec);
  const rel = m?.[1];
  if (!rel || rel.split("/").includes("..") || !EXTENSIONS.some((e) => rel.endsWith(e))) return undefined;
  return path.join(resources, rel);
}

function overlay(props: Props, docs: ConfigDoc[] | undefined, profile?: string): void {
  for (const d of docs ?? []) {
    if (profile === undefined ? !d.profiles : d.profiles?.includes(profile)) for (const [k, v] of d.props) props.set(k, v);
  }
}

/** The module's properties: `application.*` with its imports and active profiles; null when it has no `application.*`. */
function load(resources: string, rootDir: string): Props | null {
  const files = EXTENSIONS.map((e) => docsOf(path.join(resources, `application${e}`), rootDir));
  if (files.every((f) => f === undefined)) return null;
  const props: Props = new Map();
  for (const f of files) overlay(props, f);
  for (const spec of listed(props.get(relaxedKey("spring.config.import"))).slice(0, MAX_IMPORTS)) {
    const file = importedFile(resources, spec);
    if (file) overlay(props, docsOf(file, rootDir));
  }
  for (const profile of listed(props.get(relaxedKey("spring.profiles.active"))).slice(0, MAX_PROFILES)) {
    if (!/^[\w.-]+$/.test(profile)) continue;
    for (const f of files) overlay(props, f, profile);
    for (const e of EXTENSIONS) overlay(props, docsOf(path.join(resources, `application-${profile}${e}`), rootDir));
  }
  return props;
}

const cache = new Map<string, Props | null>();

/** The properties of `dir/src/main/resources`; null when it has none. */
function propsIn(dir: string, rootDir: string): Props | null {
  const key = `${rootDir}\0${dir}`;
  if (!cache.has(key)) cache.set(key, load(path.join(dir, "src", "main", "resources"), rootDir));
  return cache.get(key)!;
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
