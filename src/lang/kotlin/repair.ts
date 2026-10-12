/**
 * The Kotlin grammar wants a separator after the last member of a class body closed on the same line
 * (`companion object { const val X = 1 }`): it repairs one such body with a token it hides, and gives up on a file
 * with two. This rewrite turns the space before each `}` that ends a statement on its line into `;`, outside strings
 * and comments: the text keeps its length, so every position stays the same. The scan only uses it for a file that
 * does not parse as written, and only when the rewrite does.
 */

/** Code (its brace depth tells a string interpolation's `}` apart), a string or a raw string. */
type Context = { kind: "code"; depth: number } | { kind: "str" } | { kind: "raw" };

export function semicolonsBeforeBraces(text: string): string {
  const out = text.split("");
  const stack: Context[] = [{ kind: "code", depth: 0 }];
  let i = 0;
  while (i < text.length) {
    const top = stack[stack.length - 1]!;
    i = top.kind === "code" ? inCode(text, i, top, stack, out) : inString(text, i, top.kind === "raw", stack);
  }
  return out.join("");
}

function inCode(text: string, i: number, top: { depth: number }, stack: Context[], out: string[]): number {
  const c = text[i]!;
  if (text.startsWith("//", i)) {
    const end = text.indexOf("\n", i);
    return end < 0 ? text.length : end;
  }
  if (text.startsWith("/*", i)) return commentEnd(text, i);
  if (c === "'") return charEnd(text, i);
  if (c === '"') {
    const raw = text.startsWith('"""', i);
    stack.push({ kind: raw ? "raw" : "str" });
    return i + (raw ? 3 : 1);
  }
  if (c === "{") top.depth++;
  if (c !== "}") return i + 1;
  if (top.depth === 0 && stack.length > 1) {
    // the end of a `${...}` interpolation
    stack.pop();
    return i + 1;
  }
  top.depth--;
  if (endsStatement(text, i)) out[i - 1] = ";";
  return i + 1;
}

/** A space before `}` that follows code on the same line, other than an opening brace, a separator or a lambda arrow. */
function endsStatement(text: string, brace: number): boolean {
  if (text[brace - 1] !== " " && text[brace - 1] !== "\t") return false;
  let j = brace - 1;
  while (j >= 0 && (text[j] === " " || text[j] === "\t")) j--;
  const prev = text[j];
  if (prev === undefined || prev === "\n" || prev === "\r" || prev === "{" || prev === ";" || prev === ",") return false;
  return !(prev === ">" && text[j - 1] === "-");
}

/** Block comments nest in Kotlin. */
function commentEnd(text: string, i: number): number {
  let depth = 0;
  for (let j = i; j < text.length - 1; j++) {
    if (text.startsWith("/*", j)) {
      depth++;
      j++;
    } else if (text.startsWith("*/", j)) {
      depth--;
      j++;
      if (depth === 0) return j + 1;
    }
  }
  return text.length;
}

function charEnd(text: string, i: number): number {
  for (let j = i + 1; j < text.length && text[j] !== "\n"; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === "'") return j + 1;
  }
  return i + 1;
}

function inString(text: string, i: number, raw: boolean, stack: Context[]): number {
  if (text.startsWith("${", i)) {
    stack.push({ kind: "code", depth: 0 });
    return i + 2;
  }
  const c = text[i];
  if (!raw) {
    if (c === '"' || c === "\n") stack.pop();
    return c === "\\" ? i + 2 : i + 1;
  }
  if (!text.startsWith('"""', i)) return i + 1;
  // `""""` ends with its last three quotes
  let j = i + 3;
  while (text[j] === '"') j++;
  stack.pop();
  return j;
}
