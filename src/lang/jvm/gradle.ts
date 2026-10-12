/**
 * Gradle build scripts (Kotlin and Groovy DSL) read as text, never run: the dependencies they declare and the literal
 * `buildConfigField` values. Every pattern is anchored at a word or a quote and has no nested quantifier, so a hostile
 * script costs linear time.
 */

/** A declared dependency: Maven coordinates, or a version catalog accessor (`libs.retrofit` -> `retrofit`). */
export type GradleDep = { group: string; artifact: string; version?: string } | { catalog: string };

/** Comments out, strings kept: `// implementation("a:b:1")` declares nothing, `"https://x"` keeps its `//`. */
export function stripComments(text: string): string {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      out.push(text.slice(start, i));
      const end = text[i + 1] === "/" ? text.indexOf("\n", i) : text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : text[i + 1] === "/" ? end : end + 2;
      start = i;
    } else if (c === '"' || c === "'") i = stringEnd(text, i);
    else i++;
  }
  out.push(text.slice(start));
  return out.join(" ");
}

/** The index after the string literal starting at `i` (`"..."`, `'...'`, `"""..."""`); an unterminated one ends its line. */
function stringEnd(text: string, i: number): number {
  const quote = text.startsWith(text[i]!.repeat(3), i) ? text[i]!.repeat(3) : text[i]!;
  for (let j = i + quote.length; j < text.length; j++) {
    if (quote.length === 1 && text[j] === "\\") j++;
    else if (quote.length === 1 && text[j] === "\n") return j;
    else if (text.startsWith(quote, j)) return j + quote.length;
  }
  return text.length;
}

const CONFIGS = new Set(["implementation", "api", "compileOnly", "runtimeOnly", "compile", "kapt", "ksp", "annotationProcessor"]);
const CONFIG_SUFFIXES = ["Implementation", "Api", "CompileOnly", "RuntimeOnly"];

/** A configuration that puts a library on the app's classpath: test ones (`testImplementation`, `kaptTest`) aside. */
function isConfig(word: string): boolean {
  if (/^test|[a-z]Test/.test(word)) return false;
  return CONFIGS.has(word) || CONFIG_SUFFIXES.some((s) => word.length > s.length && word.endsWith(s) && /^[a-z]/.test(word));
}

const WORD = /[A-Za-z_]\w*/g;
const OPEN = /["']?\s*\(?\s*(?:(?:platform|enforcedPlatform)\s*\(\s*)?/y;
const STRING_NOTATION = /(["'])([^"'\s]+)\1/y;
const MAP_NOTATION = /group\s*[:=]\s*(["'])([^"']+)\1\s*,\s*name\s*[:=]\s*(["'])([^"']+)\3(?:\s*,\s*version\s*[:=]\s*(["'])([^"']*)\5)?/y;
const CATALOG_NOTATION = /libs\.([\w.]+)/y;

function sticky(re: RegExp, text: string, at: number): RegExpExecArray | null {
  re.lastIndex = at;
  return re.exec(text);
}

/** `g:a`, `g:a:v`, `g:a:v@aar`, `g:a:v:classifier`. */
function fromCoordinates(text: string): GradleDep | undefined {
  const [group, artifact, version] = text.replace(/@\w+$/, "").split(":");
  if (!group || !artifact) return undefined;
  return { group, artifact, ...(version ? { version } : {}) };
}

/** The dependency a configuration call declares at `at`: a string, a `group:` / `name:` map, or a catalog accessor. */
function notationAt(text: string, at: number): GradleDep | undefined {
  const open = sticky(OPEN, text, at);
  const from = at + (open?.[0].length ?? 0);
  const str = sticky(STRING_NOTATION, text, from);
  if (str) return fromCoordinates(str[2]!);
  const map = sticky(MAP_NOTATION, text, from);
  if (map) return { group: map[2]!, artifact: map[4]!, ...(map[6] ? { version: map[6] } : {}) };
  const lib = sticky(CATALOG_NOTATION, text, from);
  return lib ? { catalog: lib[1]! } : undefined;
}

/** Dependencies of a build script, in order: `implementation("g:a:v")`, `api 'g:a:v'`, `implementation(libs.x)`, ... */
export function gradleDependencies(script: string): GradleDep[] {
  const text = stripComments(script);
  const deps: GradleDep[] = [];
  for (const m of text.matchAll(WORD)) {
    if (!isConfig(m[0])) continue;
    const dep = notationAt(text, m.index + m[0].length);
    if (dep) deps.push(dep);
  }
  return deps;
}

const ASSIGN = /\b(\w+)\s*=\s*(["'])([^"'$\n]*)\2/g;
const SET_CALL = /\bset\s*\(\s*(["'])(\w+)\1\s*,\s*(["'])([^"'$\n]*)\3/g;
const EXTRA_INDEX = /\bextra\s*\[\s*(["'])(\w+)\1\s*\]\s*=\s*(["'])([^"'$\n]*)\3/g;

/** Literal string variables a script defines (`val okhttp = "4.12.0"`, `ext.okhttp = '4.12.0'`, `extra["okhttp"] = ...`). */
export function gradleVariables(script: string): Map<string, string> {
  const text = stripComments(script);
  const vars = new Map<string, string>();
  for (const m of text.matchAll(ASSIGN)) if (!vars.has(m[1]!)) vars.set(m[1]!, m[3]!);
  for (const re of [SET_CALL, EXTRA_INDEX]) for (const m of text.matchAll(re)) if (!vars.has(m[2]!)) vars.set(m[2]!, m[4]!);
  return vars;
}

/** `$okhttp`, `${okhttp}`, `${rootProject.ext.okhttp}`: the variable's value, else undefined (a version is never a template). */
export function resolveVersion(version: string | undefined, vars: (name: string) => string | undefined): string | undefined {
  if (!version?.includes("$")) return version;
  let unknown = false;
  const out = version.replace(/\$\{?([\w.]+)\}?/g, (_, ref: string) => {
    const value = vars(ref.split(".").pop()!);
    if (value === undefined) unknown = true;
    return value ?? "";
  });
  return unknown ? undefined : out;
}

const BUILD_CONFIG = /\s*\(?\s*(["'])(\w+)\1\s*,\s*(["'])(\w+)\3\s*,\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/y;

/** A Kotlin / Groovy string literal's value; undefined when it interpolates (`"\"$url\""`). */
function scriptString(literal: string): string | undefined {
  const body = literal.slice(1, -1);
  if (literal.startsWith('"') && /(?<!\\)\$/.test(body)) return undefined;
  return body.replace(/\\(.)/g, "$1");
}

/**
 * `buildConfigField("String", "API_URL", "\"https://api.example.com\"")`: the Java string literal each `String`
 * field is given, the first one per name (`defaultConfig` usually comes before the build types).
 */
export function buildConfigFields(script: string): Map<string, string> {
  const text = stripComments(script);
  const fields = new Map<string, string>();
  for (const m of text.matchAll(/\bbuildConfigField\b/g)) {
    const f = sticky(BUILD_CONFIG, text, m.index + m[0].length);
    if (!f || f[2] !== "String" || fields.has(f[4]!)) continue;
    const java = scriptString(f[5]!);
    const literal = java !== undefined ? /^"((?:[^"\\]|\\.)*)"$/.exec(java) : null;
    if (literal) fields.set(f[4]!, literal[1]!.replace(/\\(.)/g, "$1"));
  }
  return fields;
}
