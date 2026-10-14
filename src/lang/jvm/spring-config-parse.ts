/**
 * Spring Boot configuration files read as text: `.properties` and YAML, split into documents (`---`, `#---`) with
 * the profile each one is for. Hostile input: linear line-by-line patterns, bounded lines and values.
 */

/** Lines read per file; a longer file is generated or not configuration a module writes by hand. */
const MAX_LINES = 20_000;
const MAX_VALUE = 2_000;
/** A longer line is not a property a module writes by hand; the patterns stay linear on what is left. */
const MAX_LINE = 4_000;

export type Props = Map<string, string>;

/** One document of a file: its properties and the profiles it is activated by (none: the default document). */
export interface ConfigDoc {
  props: Props;
  profiles?: string[];
}

/** Spring's relaxed binding: `base-url`, `baseUrl` and `base_url` are one property. */
export const relaxedKey = (key: string): string => key.toLowerCase().replace(/[-_]/g, "");

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1);
  // a trailing comment (`model: gpt-4o # the default`) is not the value
  const comment = t.search(/[ \t]#/);
  return comment >= 0 ? t.slice(0, comment).trimEnd() : t;
}

const KEY = /^[A-Za-z0-9_.[\]-]+$/;

function put(props: Props, key: string, value: string): void {
  if (value.length <= MAX_VALUE && key.length <= 300) props.set(relaxedKey(key), value);
}

const ON_PROFILE = [relaxedKey("spring.config.activate.on-profile"), relaxedKey("spring.profiles")];

/**
 * The profiles a document is for: `on-profile: dev` or `dev, local` (any of them). A profile expression (`!prod`,
 * `a & b`) is for no profile this reader activates.
 */
function docOf(props: Props): ConfigDoc {
  const expr = ON_PROFILE.map((k) => props.get(k)).find((v) => v !== undefined);
  if (expr === undefined) return { props };
  const names = expr.split(",").map((s) => s.trim());
  return { props, profiles: names.every((n) => /^[\w.-]+$/.test(n)) ? names : [] };
}

function propertiesDoc(lines: string[]): Props {
  const props: Props = new Map();
  for (const line of lines) {
    const body = line.trim();
    if (line.length > MAX_LINE || body.startsWith("#") || body.startsWith("!")) continue;
    const eq = body.search(/[=:]/);
    const key = eq > 0 ? body.slice(0, eq).trim() : "";
    if (KEY.test(key)) put(props, key, body.slice(eq + 1).trim());
  }
  return props;
}

/** `.properties` documents, split by `#---` / `!---` lines (Spring Boot 2.4+). */
export function propertiesDocs(text: string): ConfigDoc[] {
  const docs: ConfigDoc[] = [];
  let lines: string[] = [];
  for (const line of text.split(/\r?\n/, MAX_LINES)) {
    if (/^[#!]---\s*$/.test(line)) {
      docs.push(docOf(propertiesDoc(lines)));
      lines = [];
    } else lines.push(line);
  }
  docs.push(docOf(propertiesDoc(lines)));
  return docs;
}

/** `key: value`, `key:` or `"quoted key": value`: the key and the value's text; undefined for anything else. */
function yamlEntry(body: string): { key: string; value: string } | undefined {
  const quote = body[0] === '"' || body[0] === "'" ? body.indexOf(body[0], 1) : -1;
  const from = quote > 0 ? quote + 1 : 0;
  const colon = body.indexOf(":", from);
  if (colon <= 0 || (colon + 1 < body.length && body[colon + 1] !== " " && body[colon + 1] !== "\t")) return undefined;
  const key = quote > 0 ? body.slice(1, quote) : body.slice(0, colon).trim();
  if (!key || (quote < 0 && !/^[^\s#"'{[-]/.test(key)) || key.includes("#")) return undefined;
  return { key, value: body.slice(colon + 1).trim() };
}

/** One YAML document: nested block mappings with scalar values (lists, block scalars and flow collections are left out). */
function parseYamlDocument(lines: string[]): Props {
  const props: Props = new Map();
  const stack: { indent: number; key: string }[] = [];
  let skipBelow = -1;
  for (const line of lines) {
    if (line.length > MAX_LINE) continue;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    if (body === "" || body.startsWith("#")) continue;
    if (skipBelow >= 0 && indent > skipBelow) continue;
    skipBelow = -1;
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const entry = yamlEntry(body);
    if (!entry) {
      // a list item or anything else: what is nested under it is not a mapping of this document
      skipBelow = indent;
      continue;
    }
    const key = [...stack.map((s) => s.key), entry.key].join(".");
    const value = entry.value;
    if (value === "" || value.startsWith("#")) stack.push({ indent, key: entry.key });
    else if (/^[|>[{&*!]/.test(value)) skipBelow = indent;
    else put(props, key, unquote(value));
  }
  return props;
}

/** YAML documents, split by `---` lines. */
export function yamlDocs(text: string): ConfigDoc[] {
  const docs: ConfigDoc[] = [];
  let lines: string[] = [];
  for (const line of text.split(/\r?\n/, MAX_LINES)) {
    if (/^---\s*$/.test(line)) {
      docs.push(docOf(parseYamlDocument(lines)));
      lines = [];
    } else lines.push(line);
  }
  docs.push(docOf(parseYamlDocument(lines)));
  return docs;
}

/** The default documents' properties, later documents over earlier ones. */
const defaults = (docs: ConfigDoc[]): Props => new Map(docs.filter((d) => !d.profiles).flatMap((d) => [...d.props]));

export const parseYaml = (text: string): Props => defaults(yamlDocs(text));
export const parseProperties = (text: string): Props => defaults(propertiesDocs(text));
