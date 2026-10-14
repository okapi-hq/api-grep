import { partsToTemplate } from "../resolve/parts.js";
import { partsOf } from "../resolve/string-template.js";
import type { Part, Shape } from "../types.js";

/** Marks a computed part while the text is checked: a private-use character, never part of a document's syntax. */
const GAP = "";
/** `query ${name} {`, `query Get${Kind} {`: a computed operation name. */
const COMPUTED_NAME = /^\s*(?:#[^\n]*\n\s*)*(?:query|mutation|subscription)\s+[_0-9A-Za-z]*/;

type Lexed = "text" | "string" | "block" | "comment";

/** Where the GraphQL lexer stands after `text`: in a string, a block string, a comment, or the document's syntax. */
function advance(state: Lexed, text: string): Lexed {
  let st = state;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (st === "comment") {
      if (c === "\n" || c === "\r") st = "text";
    } else if (st === "text") {
      if (c === "#") st = "comment";
      else if (text.startsWith('"""', i)) [st, i] = ["block", i + 2];
      else if (c === '"') st = "string";
    } else if (st === "string") {
      if (c === "\\") i++;
      else if (c === '"' || c === "\n" || c === "\r") st = "text";
    } else if (text.startsWith('\\"""', i)) {
      i += 3;
    } else if (text.startsWith('"""', i)) {
      [st, i] = ["text", i + 2];
    }
  }
  return st;
}

/** `{name}` for a computed part written in a string, as the report writes templates, without what would end the string. */
const placeholder = (p: Part): string => partsToTemplate([p]).replace(/["\\\r\n]/g, "");

/**
 * The text of a document built with computed parts, read without them: one standing for a fragment or a selection
 * the scan could not resolve would otherwise read as a field (a `${Fragment}` not resolved, `` `${a} ${b}` `` sent as a
 * search query). In a string (`user(id: "${id}")`) the part is a `{name}` placeholder, so an argument's value is not
 * read as the empty string. A computed operation name leaves the document unread.
 */
export function documentTemplate(s: Shape): string | undefined {
  const parts = partsOf(s);
  if (!parts) return undefined;
  let state: Lexed = "text";
  let text = "";
  for (const p of parts) {
    if (p.kind === "static") {
      text += p.text;
      state = advance(state, p.text);
    } else {
      text += state === "string" || state === "block" ? placeholder(p) : GAP;
    }
  }
  return COMPUTED_NAME.test(text) ? undefined : text.replaceAll(GAP, "");
}
