import { markConst, staticText } from "../../resolve/parts.js";
import type { Part } from "../../types.js";
import type { SyntaxNode } from "../tree-sitter.js";
import { bindingFor, enclosingFn, type Binding, type FileScope } from "./scope.js";

const MAX_DEPTH = 8;
/** Variables read for one command: `A="$B$B$B"`, `B="$C$C$C"`… cannot make a script's words grow without bound. */
const MAX_READS = 2000;

/** Where a word is read: the file's names, the place of the read, and a wrapper's call-site arguments (`$1`, `"$@"`). */
export interface WordCtx {
  scope: FileScope;
  offset: number;
  fn?: number;
  visiting: ReadonlySet<string>;
  depth: number;
  positional?: Part[][];
  /** Set once a word reads the function's arguments: the request is built from them (a wrapper). */
  reads?: { positional: boolean };
  /** Variable reads left for the command (`MAX_READS`), shared by every read it makes. */
  budget: { left: number };
}

export function wordCtx(scope: FileScope, node: SyntaxNode, positional?: Part[][]): WordCtx {
  return { scope, offset: node.startIndex, fn: enclosingFn(node), visiting: new Set(), depth: 0, positional, reads: { positional: false }, budget: { left: MAX_READS } };
}

const stat = (text: string): Part => ({ kind: "static", text });
const dyn = (name: string, origin: "param" | "call" | "env" | "unknown"): Part => ({ kind: "dynamic", name, origin });

/** Outside quotes a backslash keeps the next character (and joins lines). */
const unescapeWord = (s: string): string => s.replace(/\\\r?\n/g, "").replace(/\\(.)/g, "$1");
/** In double quotes only `$`, `` ` ``, `"`, `\` and a newline are escaped. */
const unescapeQuoted = (s: string): string => s.replace(/\\\r?\n/g, "").replace(/\\([$`"\\])/g, "$1");

const ANSI: Record<string, string> = { n: "\n", t: "\t", r: "\r", e: "\x1b", a: "\x07", b: "\b", f: "\f", v: "\v", "\\": "\\", "'": "'", '"': '"' };
/** `$'a\nb'`: C escapes, `\xHH` included. */
const unescapeAnsiC = (s: string): string =>
  s.replace(/\\(x[0-9a-fA-F]{1,2}|.)/g, (_, c: string) => (c.length > 1 ? String.fromCharCode(parseInt(c.slice(1), 16)) : (ANSI[c] ?? c)));

/** A name usable in a `{placeholder}`: the command a `$(...)` runs (`$(jq -r .id f)` is `jq`), else `value`. */
function substitutionName(node: SyntaxNode): string {
  const cmd = node.namedChildren.find((c) => c?.type === "command");
  const word = cmd?.childForFieldName("name")?.text ?? "";
  const base = word.split("/").pop() ?? "";
  return /^[A-Za-z_][\w-]{0,40}$/.test(base) ? base : "value";
}

/** The parts of a node's children, the text between them (unescaped by `gap`) included. */
function withGaps(node: SyntaxNode, start: number, end: number, gap: (s: string) => string, ctx: WordCtx): Part[] {
  const out: Part[] = [];
  let pos = start;
  for (const c of node.namedChildren) {
    if (!c || c.startIndex < start || c.endIndex > end) continue;
    if (c.startIndex > pos) out.push(stat(gap(node.text.slice(pos - node.startIndex, c.startIndex - node.startIndex))));
    out.push(...(c.type === "string_content" ? [stat(unescapeQuoted(c.text))] : wordParts(c, ctx)));
    pos = c.endIndex;
  }
  if (pos < end) out.push(stat(gap(node.text.slice(pos - node.startIndex, end - node.startIndex))));
  return out;
}

/** What a word, a string or an expansion holds, as static text, env reads and dynamic values. */
export function wordParts(node: SyntaxNode, ctx: WordCtx): Part[] {
  switch (node.type) {
    // literal text, also where the grammar names it otherwise (`gpt` of `${M:-gpt-4o}`, a `${X%/}` pattern)
    case "word":
    case "number":
    case "variable_name":
    case "extglob_pattern":
    case "regex":
      return [stat(unescapeWord(node.text))];
    case "raw_string":
      return [stat(node.text.slice(1, -1))];
    case "ansi_c_string":
      return [stat(unescapeAnsiC(node.text.slice(2, -1)))];
    case "string":
      return withGaps(node, node.startIndex + 1, node.endIndex - 1, unescapeQuoted, ctx);
    case "translated_string":
      return withGaps(node, node.startIndex + 2, node.endIndex - 1, unescapeQuoted, ctx);
    case "concatenation":
      return withGaps(node, node.startIndex, node.endIndex, unescapeWord, ctx);
    case "simple_expansion":
      return varParts(node.namedChildren[0]?.text ?? "", ctx);
    case "expansion":
      return expansionParts(node, ctx);
    case "command_substitution":
      return [dyn(substitutionName(node), "call")];
    default:
      return [dyn("value", "unknown")];
  }
}

const POSITIONAL = /^[1-9]$/;

function positionalParts(name: string, ctx: WordCtx): Part[] {
  if (ctx.reads) ctx.reads.positional = true;
  if (ctx.positional) {
    if (POSITIONAL.test(name)) return ctx.positional[Number(name) - 1] ?? [];
    return ctx.positional.flatMap((p, i) => (i > 0 ? [stat(" "), ...p] : p));
  }
  return [dyn(POSITIONAL.test(name) ? `arg${name}` : "args", "param")];
}

/** The value a binding gives, read where it was written. */
function bindingParts(name: string, b: Binding, ctx: WordCtx): Part[] {
  if (b.kind === "loop") return [dyn(name, "param")];
  if (b.kind === "read") return [dyn(name, "unknown")];
  const value = b.kind === "array" ? b.elements?.[0] : b.value;
  if (!value) return [];
  const own = b.fn === ctx.fn;
  const inner: WordCtx = { ...ctx, offset: b.offset, fn: b.fn, visiting: new Set([...ctx.visiting, name]), depth: ctx.depth + 1, positional: own ? ctx.positional : undefined, reads: own ? ctx.reads : undefined };
  const parts = wordParts(value, inner);
  // a value past the reads' budget is one unknown value, not thousands
  if (ctx.budget.left < 0) return [dyn(name, "unknown")];
  // `ID=$(jq -r .id f)`, `ID="$(...)"`: the value is named after the variable
  const only = value.type === "string" && value.namedChildCount === 1 ? value.namedChildren[0] : value;
  if (only?.type === "command_substitution" && parts.length === 1 && parts[0]!.kind === "dynamic") return [{ ...parts[0]!, name }];
  return markConst(parts);
}

/** `$NAME`: the file's assignment, else an env var (`fallback` from `${NAME:-default}`). */
export function varParts(name: string, ctx: WordCtx, fallback?: Part[]): Part[] {
  if (POSITIONAL.test(name) || name === "@" || name === "*") return positionalParts(name, ctx);
  if (!/^[A-Za-z_]\w*$/.test(name)) return [dyn(name === "0" ? "script" : "value", "unknown")];
  if (--ctx.budget.left < 0) return [dyn(name, "unknown")];
  const b = ctx.depth < MAX_DEPTH && !ctx.visiting.has(name) ? bindingFor(ctx.scope, name, ctx.offset, ctx.fn) : undefined;
  if (b) return bindingParts(name, b, ctx);
  const text = fallback ? staticText(fallback) : undefined;
  return [{ kind: "env", name, ...(text ? { fallback: text } : {}) }];
}

const DEFAULTS = new Set([":-", "-", ":=", "="]);
const ALTERNATES = new Set([":+", "+"]);

/** `${NAME}`, `${NAME:-default}`, `${NAME:+alt}`, `${NAME%/}`, `${ARR[0]}`; `${#NAME}` and `${!NAME}` are unknown. */
function expansionParts(node: SyntaxNode, ctx: WordCtx): Part[] {
  const kids = node.children.filter((c): c is SyntaxNode => !!c);
  if (kids[1]?.type === "#" || kids[1]?.type === "!") return [dyn("value", "unknown")];
  const target = kids.find((c) => c.type === "variable_name" || c.type === "special_variable_name" || c.type === "subscript");
  if (!target) return [dyn("value", "unknown")];
  if (target.type === "subscript") return subscriptParts(target, ctx);
  const op = kids.find((c) => !c.isNamed && c.startIndex >= target.endIndex && c.type !== "}");
  const operand = kids.filter((c) => c.isNamed && op && c.startIndex >= op.endIndex).flatMap((c) => wordParts(c, ctx));
  if (op && DEFAULTS.has(op.type)) return varParts(target.text, ctx, operand);
  if (op && ALTERNATES.has(op.type)) return operand;
  const parts = varParts(target.text, ctx);
  // `${BASE_URL%/}`: without its trailing slash
  const last = parts[parts.length - 1];
  if (op?.type === "%" && staticText(operand) === "/" && last?.kind === "static" && last.text.endsWith("/")) return [...parts.slice(0, -1), { ...last, text: last.text.slice(0, -1) }];
  return parts;
}

/** `${ARR[0]}`, `${ARR[@]}` in a string: an element of an array the file assigns, else a parameter. */
function subscriptParts(node: SyntaxNode, ctx: WordCtx): Part[] {
  const name = node.childForFieldName("name")?.text ?? "";
  const index = node.childForFieldName("index")?.text ?? "";
  const b = !ctx.visiting.has(name) && ctx.depth < MAX_DEPTH && --ctx.budget.left >= 0 ? bindingFor(ctx.scope, name, ctx.offset, ctx.fn) : undefined;
  if (b?.kind !== "array" || !b.elements) return [dyn(/^\w+$/.test(name) ? name : "value", "param")];
  const inner: WordCtx = { ...ctx, offset: b.offset, fn: b.fn, visiting: new Set([...ctx.visiting, name]), depth: ctx.depth + 1 };
  const picked = /^\d+$/.test(index) ? [b.elements[Number(index)]] : b.elements;
  return markConst(picked.flatMap((e, i) => (e ? [...(i > 0 ? [stat(" ")] : []), ...wordParts(e, inner)] : [])));
}

/** `"${ARR[@]}"`, `"$@"`, `"${@:2}"`: an argument that expands to several words (`from`: the first positional one). */
export function spreadOf(node: SyntaxNode): { array?: string; positional?: boolean; from?: number } | undefined {
  const inner = node.type === "string" && node.namedChildCount === 1 ? node.namedChildren[0]! : node;
  if (inner.type === "simple_expansion" && /^[@*]$/.test(inner.namedChildren[0]?.text ?? "")) return { positional: true };
  if (inner.type !== "expansion") return undefined;
  const t = inner.namedChildren[0];
  if (t?.type === "special_variable_name" && /^[@*]$/.test(t.text)) {
    const from = /^\$\{[@*]:(\d+)\}$/.exec(inner.text)?.[1];
    if (inner.namedChildCount === 1 || from) return { positional: true, from: from ? Number(from) : undefined };
  }
  if (inner.namedChildCount === 1 && t?.type === "subscript" && /^[@*]$/.test(t.childForFieldName("index")?.text ?? "")) return { array: t.childForFieldName("name")?.text };
  return undefined;
}
