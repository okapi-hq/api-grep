import { parse as parseToml } from "smol-toml";
import { ts } from "ts-morph";
import { isSafeKey } from "../../record-keys.js";

/**
 * A configuration file read as a tree of values, each string with where it is written (1-based line and column).
 * JSON is read with TypeScript's JSON parser, which takes comments and trailing commas (JSONC: VS Code, opencode,
 * Zed) and gives positions; TOML (Codex) with the TOML reader the config files use, positions found in the text.
 * Bounds on hostile input: nesting depth and values read.
 */

export interface Pos {
  line: number;
  col: number;
}

export type Value =
  | { kind: "string"; value: string; pos?: Pos }
  | { kind: "object"; entries: Map<string, Value> }
  | { kind: "array"; items: Value[] }
  | { kind: "other" };

export interface Document {
  root: Value;
  /** Where a string is written; `anchor` is a text written before it (its server's name), for formats without positions. */
  locate(s: Extract<Value, { kind: "string" }>, anchor: string): Pos;
}

export class ConfigParseError extends Error {}

const MAX_DEPTH = 12;
const MAX_VALUES = 20_000;

interface Budget {
  left: number;
}

const OTHER: Value = { kind: "other" };

function fromJson(node: ts.Expression, sf: ts.SourceFile, budget: Budget, depth: number): Value {
  if (--budget.left < 0 || depth > MAX_DEPTH) return OTHER;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const at = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return { kind: "string", value: node.text, pos: { line: at.line + 1, col: at.character + 1 } };
  }
  if (ts.isArrayLiteralExpression(node)) return { kind: "array", items: node.elements.map((e) => fromJson(e, sf, budget, depth + 1)) };
  if (!ts.isObjectLiteralExpression(node)) return OTHER;
  const entries = new Map<string, Value>();
  for (const p of node.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const key = ts.isStringLiteral(p.name) || ts.isIdentifier(p.name) || ts.isNumericLiteral(p.name) ? p.name.text : undefined;
    if (key !== undefined && isSafeKey(key) && !entries.has(key)) entries.set(key, fromJson(p.initializer, sf, budget, depth + 1));
  }
  return { kind: "object", entries };
}

/** JSON with comments and trailing commas; a file that does not parse is a `ConfigParseError`. */
export function readJson(text: string): Document {
  const sf = ts.parseJsonText("config.json", text);
  const diag = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  const first = diag[0];
  if (first) {
    const line = first.start !== undefined ? sf.getLineAndCharacterOfPosition(first.start).line + 1 : 1;
    throw new ConfigParseError(`syntax error at line ${line}`);
  }
  const expr = sf.statements[0]?.expression;
  const root = expr ? fromJson(expr, sf, { left: MAX_VALUES }, 0) : OTHER;
  return { root, locate: (s) => s.pos ?? { line: 1, col: 1 } };
}

function fromPlain(v: unknown, budget: Budget, depth: number): Value {
  if (--budget.left < 0 || depth > MAX_DEPTH) return OTHER;
  if (typeof v === "string") return { kind: "string", value: v };
  if (Array.isArray(v)) return { kind: "array", items: v.map((x) => fromPlain(x, budget, depth + 1)) };
  if (v === null || typeof v !== "object" || v instanceof Date) return OTHER;
  const entries = new Map<string, Value>();
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (isSafeKey(k)) entries.set(k, fromPlain(x, budget, depth + 1));
  return { kind: "object", entries };
}

/** 1-based line and column of an offset of `text`. */
function posAt(text: string, offset: number): Pos {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, col: offset - before.lastIndexOf("\n") };
}

/** TOML: a string's place is its first occurrence after its anchor (the server's table), at the quote opening it. */
export function readToml(text: string): Document {
  let data: unknown;
  try {
    data = parseToml(text);
  } catch (err) {
    const line = (err as { line?: unknown }).line;
    throw new ConfigParseError(`syntax error${typeof line === "number" ? ` at line ${line}` : ""}`);
  }
  const root = fromPlain(data, { left: MAX_VALUES }, 0);
  const locate: Document["locate"] = (s, anchor) => {
    // the server's table (`[mcp_servers.name]`, `[mcp_servers."a name"]`), else the first place its name is written
    const from = [`.${anchor}]`, `."${anchor}"]`, anchor].map((a) => text.indexOf(a)).find((i) => i >= 0) ?? 0;
    const found = text.indexOf(s.value, from);
    const at = found >= 0 ? found : text.indexOf(s.value);
    if (at < 0) return { line: 1, col: 1 };
    return posAt(text, at > 0 && /["']/.test(text[at - 1]!) ? at - 1 : at);
  };
  return { root, locate };
}

/** The value under a key of an object, if it is one. */
export const member = (v: Value | undefined, key: string): Value | undefined => (v?.kind === "object" ? v.entries.get(key) : undefined);

/** The string under a key of an object, if it is one. */
export function stringAt(v: Value | undefined, key: string): Extract<Value, { kind: "string" }> | undefined {
  const m = member(v, key);
  return m?.kind === "string" ? m : undefined;
}
