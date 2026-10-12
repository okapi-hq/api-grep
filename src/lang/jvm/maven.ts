/**
 * A pom.xml read as text: its dependencies, the versions its `dependencyManagement` pins and its `properties`.
 * Elements are cut with `indexOf`, never a regex spanning the file, so a hostile pom costs linear time.
 */

export interface PomDependency {
  group: string;
  artifact: string;
  /** As written: a literal, `${property}`, or absent (managed by a parent or a BOM). */
  version?: string;
}

export interface Pom {
  dependencies: PomDependency[];
  /** `group:artifact` -> version, from `dependencyManagement`. */
  managed: Map<string, string>;
  properties: Map<string, string>;
}

/** The contents of every `<tag>...</tag>` element, in order (nested elements of the same tag are not expected). */
function elements(text: string, tag: string): string[] {
  const out: string[] = [];
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  for (let i = text.indexOf(open); i >= 0; ) {
    const end = text.indexOf(close, i + open.length);
    if (end < 0) break;
    out.push(text.slice(i + open.length, end));
    i = text.indexOf(open, end + close.length);
  }
  return out;
}

/** The text with every `<tag>...</tag>` element (or `<!--...-->` comment) removed. */
function without(text: string, open: string, close: string): string {
  const out: string[] = [];
  let from = 0;
  for (let i = text.indexOf(open); i >= 0; i = text.indexOf(open, from)) {
    const end = text.indexOf(close, i + open.length);
    out.push(text.slice(from, i));
    from = end < 0 ? text.length : end + close.length;
  }
  out.push(text.slice(from));
  return out.join(" ");
}

const value = (block: string, tag: string): string | undefined => elements(block, tag)[0]?.trim() || undefined;

function dependency(block: string): PomDependency | undefined {
  const group = value(block, "groupId");
  const artifact = value(block, "artifactId");
  if (!group || !artifact) return undefined;
  const version = value(block, "version");
  return { group, artifact, ...(version ? { version } : {}) };
}

function readProperties(text: string): Map<string, string> {
  const props = new Map<string, string>();
  for (const block of elements(text, "properties")) {
    for (const m of block.matchAll(/<([\w.-]+)>([^<]*)<\/\1>/g)) if (!props.has(m[1]!)) props.set(m[1]!, m[2]!.trim());
  }
  return props;
}

/** Dependencies outside `build` (plugin dependencies) and `dependencyManagement`, test scope aside. */
export function parsePom(xml: string): Pom {
  const text = without(xml, "<!--", "-->");
  const managed = new Map<string, string>();
  for (const block of elements(text, "dependencyManagement").flatMap((m) => elements(m, "dependency"))) {
    const d = dependency(block);
    if (d?.version) managed.set(`${d.group}:${d.artifact}`, d.version);
  }
  const body = without(without(without(text, "<dependencyManagement>", "</dependencyManagement>"), "<build>", "</build>"), "<reporting>", "</reporting>");
  const dependencies = elements(body, "dependency")
    .filter((block) => value(block, "scope") !== "test")
    .flatMap((block) => dependency(block) ?? []);
  return { dependencies, managed, properties: readProperties(text) };
}

/** `${okhttp.version}` with the properties in scope (this pom's, then its parents'); undefined when one is unknown. */
export function pomVersion(version: string | undefined, props: (name: string) => string | undefined): string | undefined {
  if (!version?.includes("${")) return version;
  let unknown = false;
  const out = version.replace(/\$\{([\w.-]+)\}/g, (_, name: string) => {
    const v = props(name);
    if (v === undefined || v.includes("${")) unknown = true;
    return v ?? "";
  });
  return unknown ? undefined : out;
}
