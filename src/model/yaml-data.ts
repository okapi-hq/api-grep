/**
 * A YAML file's block mappings with their scalar values, as nested objects: what a config file a program loads
 * (`yaml.safe_load(open("config.yaml"))`) says under a key path. Lists, block scalars, anchors, tags and flow
 * collections are left out, and so is every document but the first. Hostile input: linear line-by-line patterns,
 * bounded lines, keys and values.
 */

export type ConfigValue = string | number | boolean | null | ConfigValue[] | { [key: string]: ConfigValue };
export type ConfigObject = { [key: string]: ConfigValue };

const MAX_LINES = 20_000;
const MAX_LINE = 4_000;
const MAX_VALUE = 2_000;
const MAX_DEPTH = 16;

/** `key: value`, `key:` or `"quoted key": value`; undefined for a list item or anything else. */
function entry(body: string): { key: string; value: string } | undefined {
  const quote = body[0] === '"' || body[0] === "'" ? body.indexOf(body[0], 1) : -1;
  const colon = body.indexOf(":", quote > 0 ? quote + 1 : 0);
  if (colon <= 0 || (colon + 1 < body.length && body[colon + 1] !== " " && body[colon + 1] !== "\t")) return undefined;
  const key = quote > 0 ? body.slice(1, quote) : body.slice(0, colon).trim();
  if (!key || key.length > 200 || (quote < 0 && !/^[^\s#"'{[\-?&*!|>%@`]/.test(key))) return undefined;
  return { key, value: body.slice(colon + 1).trim() };
}

/** A scalar's value: quotes removed, a trailing comment dropped; YAML's plain `true`, numbers and `null` typed. */
function scalar(raw: string): ConfigValue {
  if (raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))) return raw.slice(1, -1);
  const comment = raw.search(/[ \t]#/);
  const t = comment >= 0 ? raw.slice(0, comment).trimEnd() : raw;
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  if (/^(null|~)$/i.test(t)) return null;
  if (/^-?\d+(\.\d+)?$/.test(t) && t.length < 16) return Number(t);
  return t;
}

type Level = { indent: number; obj?: ConfigObject; parent?: ConfigObject; key?: string };

/** The mapping a level holds, made when its first entry comes (a key over a list holds none). */
function mapping(level: Level): ConfigObject {
  if (!level.obj) level.parent![level.key!] = level.obj = Object.create(null) as ConfigObject;
  return level.obj;
}

export function yamlData(text: string): ConfigObject {
  const root: ConfigObject = Object.create(null) as ConfigObject;
  const stack: Level[] = [{ indent: -1, obj: root }];
  let skipBelow = -1;
  for (const line of text.split(/\r?\n/, MAX_LINES)) {
    if (/^(---|\.\.\.)\s*$/.test(line)) {
      if (Object.keys(root).length > 0) break;
      continue;
    }
    if (line.length > MAX_LINE || /^\s*(#|$)/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    if (skipBelow >= 0 && indent > skipBelow) continue;
    skipBelow = -1;
    while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const found = entry(line.trim());
    if (!found) {
      // a list item or anything else: what is nested under it is no mapping read here
      skipBelow = indent;
      continue;
    }
    const parent = mapping(stack[stack.length - 1]!);
    if (found.value === "" || found.value.startsWith("#")) {
      if (stack.length > MAX_DEPTH) skipBelow = indent;
      else stack.push({ indent, parent, key: found.key });
    } else if (/^[|>[{&*!]/.test(found.value) || found.value.length > MAX_VALUE) skipBelow = indent;
    else parent[found.key] = scalar(found.value);
  }
  return root;
}
