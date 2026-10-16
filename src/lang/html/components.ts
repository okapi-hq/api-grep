import { withoutComments, type HtmlDoc } from "./extract.js";

/**
 * Single-file components (Vue, Svelte, Astro) read as the TypeScript of their scripts: `<script>` and `<script setup>`
 * blocks, and an Astro component's `---` frontmatter (code the server runs). Like an HTML page, the text keeps the
 * file's size with everything else blank, so a position in it is the same line and column in the component.
 * Template expressions (`{#await fetch(...)}`, `@click="..."`) are not read.
 */
export const COMPONENT_EXTENSIONS = [".vue", ".svelte", ".astro"];

export function isComponent(file: string): boolean {
  const lower = file.toLowerCase();
  return COMPONENT_EXTENSIONS.some((e) => lower.endsWith(e));
}

/** `lang` values of a script that is no JavaScript or TypeScript (`<script lang="coffee">`), and data scripts. */
const NOT_CODE = /^(?:coffee|coffeescript|ls|livescript|json|application\/(?:ld\+)?json|importmap|text\/template)$/i;

const blank = (s: string): string => s.replace(/[^\r\n]/g, " ");

function copy(chars: string[], start: number, code: string): void {
  for (let i = 0; i < code.length; i++) chars[start + i] = code[i]!;
  // the end of a block ends its last statement, so two blocks never run into each other
  if (start + code.length < chars.length) chars[start + code.length] = ";";
}

/** Backticks in `code` that are not escaped: an odd count leaves a template literal open. */
const backticks = (code: string): number => (code.match(/(?<!\\)`/g) ?? []).length;

/**
 * An Astro component's frontmatter: the code between a `---` first line and the next `---` line that is not inside a
 * template literal (a Markdown sample in a string).
 */
function frontmatter(text: string, chars: string[]): boolean {
  const open = /^\uFEFF?\s*---[ \t]*\r?\n/.exec(text);
  if (!open) return false;
  const start = open[0].length;
  for (const close of text.slice(start).matchAll(/^---[ \t]*$/gm)) {
    const code = text.slice(start, start + close.index);
    if (backticks(code) % 2 === 1) continue;
    copy(chars, start, code);
    return true;
  }
  return false;
}

function scriptBlocks(text: string, chars: string[]): boolean {
  let found = false;
  for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const kind = /\b(?:lang|type)\s*=\s*["']?([^"'\s>]+)/i.exec(m[1]!)?.[1] ?? "";
    if (/\bsrc\s*=/i.test(m[1]!) || NOT_CODE.test(kind) || !m[2]!.trim()) continue;
    copy(chars, m.index + m[0].indexOf(">") + 1, m[2]!);
    found = true;
  }
  return found;
}

/** Reads a component's scripts (as one TypeScript text the size of the file); it submits no form and loads no CDN script. */
export function parseComponent(file: string, source: string): HtmlDoc {
  const text = withoutComments(source);
  const chars = blank(text).split("");
  const fromFrontmatter = file.toLowerCase().endsWith(".astro") && frontmatter(text, chars);
  const fromScripts = scriptBlocks(text, chars);
  const doc: HtmlDoc = { module: true, forms: [], cdnPackages: [] };
  if (fromFrontmatter || fromScripts) doc.script = chars.join("");
  return doc;
}
