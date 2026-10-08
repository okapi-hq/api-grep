import { packageFromCdnUrl } from "../../detect/origin.js";
import { neutralizeTemplates } from "./templates.js";

/** A form submitted to an explicit action URL. */
export interface HtmlForm {
  action: string;
  method: string;
  enctype?: string;
  fields: FormField[];
  /** 1-based position of `<form`. */
  line: number;
  col: number;
}

export interface FormField {
  name: string;
  type: string;
  required: boolean;
  value?: string;
}

export interface HtmlDoc {
  /**
   * The inline scripts as one JavaScript text the size of the file: everything else is blank (newlines kept), so a
   * position in it is the same line and column in the HTML file. Undefined when the page has no inline script.
   */
  script?: string;
  /** Inline scripts that are ES modules: they can `import`. */
  module: boolean;
  forms: HtmlForm[];
  /** npm packages loaded from a CDN (`<script src="https://cdn.jsdelivr.net/npm/axios">`). */
  cdnPackages: string[];
}

/** Script types that are JavaScript; JSON, templates and import maps are not. */
const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "module", "text/babel", "application/x-javascript", "text/ecmascript", "text/jsx"]);
const ATTR_RE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of tag.matchAll(ATTR_RE)) out.set(m[1]!.toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

/** Same length, newlines kept: positions after it do not move. */
const blank = (s: string): string => s.replace(/[^\r\n]/g, " ");

/** `<!-- ... -->` hides what it contains, outside scripts (`<script><!-- code //--></script>` is old-style code). */
function withoutComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const comment = text.indexOf("<!--", i);
    const script = text.slice(i).search(/<script\b/i);
    const scriptAt = script < 0 ? -1 : i + script;
    if (comment < 0 && scriptAt < 0) break;
    if (scriptAt >= 0 && (comment < 0 || scriptAt < comment)) {
      const close = text.slice(scriptAt).search(/<\/script\s*>/i);
      const end = close < 0 ? text.length : scriptAt + close;
      out += text.slice(i, end);
      i = end;
      if (close < 0) break;
      out += text[i]!;
      i++;
      continue;
    }
    const end = text.indexOf("-->", comment + 4);
    const stop = end < 0 ? text.length : end + 3;
    out += text.slice(i, comment) + blank(text.slice(comment, stop));
    i = stop;
  }
  return out + text.slice(i);
}

/** In a classic script `<!--` starts a line comment, and so does `-->` at the start of a line (old pages hide code that way). */
function htmlLikeComments(code: string): string {
  return code.replace(/<!--/g, "//  ").replace(/^([ \t]*)-->/gm, "$1// ");
}

function position(text: string, index: number): { line: number; col: number } {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  return { line, col: index - before.lastIndexOf("\n") };
}

function scripts(text: string, doc: HtmlDoc): void {
  const chars = blank(text).split("");
  let found = false;
  for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = attributes(m[1]!);
    const src = attrs.get("src");
    if (src) {
      const pkg = packageFromCdnUrl(src);
      if (pkg) doc.cdnPackages.push(pkg);
      continue;
    }
    const type = (attrs.get("type") ?? "").toLowerCase();
    if (!JS_TYPES.has(type) || !m[2]!.trim()) continue;
    if (type === "module") doc.module = true;
    const start = m.index + m[0].indexOf(">") + 1;
    const code = htmlLikeComments(type === "text/babel" || type === "text/jsx" ? m[2]! : neutralizeTemplates(m[2]!));
    for (let i = 0; i < code.length; i++) chars[start + i] = code[i]!;
    // the closing tag ends the statement, so two scripts never run into each other
    chars[start + m[2]!.length] = ";";
    found = true;
  }
  if (found) doc.script = chars.join("");
}

function fields(body: string): FormField[] {
  const out: FormField[] = [];
  for (const m of body.matchAll(/<(input|select|textarea|button)\b([^>]*)>/gi)) {
    const attrs = attributes(m[2]!);
    const name = attrs.get("name");
    const type = (attrs.get("type") ?? (m[1]!.toLowerCase() === "input" ? "text" : m[1]!.toLowerCase())).toLowerCase();
    if (!name || (m[1]!.toLowerCase() === "button" && !attrs.has("value")) || ["submit", "reset", "image"].includes(type)) continue;
    if (out.some((f) => f.name === name)) continue;
    out.push({ name, type, required: attrs.has("required"), ...(attrs.has("value") ? { value: attrs.get("value") } : {}) });
  }
  return out;
}

/** An action the browser sends somewhere: not an anchor, a script URL, a mail link or a server-side template. */
function sendsRequest(action: string | undefined): action is string {
  if (!action || !action.trim()) return false;
  return !/^(?:#|javascript:|mailto:|tel:)/i.test(action) && !/\{\{|\{%|<%|<\?|\$\{/.test(action);
}

function forms(text: string, doc: HtmlDoc): void {
  for (const m of text.matchAll(/<form\b([^>]*)>([\s\S]*?)(?:<\/form\s*>|$)/gi)) {
    const attrs = attributes(m[1]!);
    const action = attrs.get("action");
    if (!sendsRequest(action)) continue;
    const { line, col } = position(text, m.index);
    const enctype = attrs.get("enctype");
    doc.forms.push({ action: action.trim(), method: (attrs.get("method") || "GET").toUpperCase(), ...(enctype ? { enctype } : {}), fields: fields(m[2]!), line, col });
  }
}

/** Reads what an HTML page sends: its inline scripts (as one JavaScript text), its forms and its CDN packages. */
export function parseHtml(source: string): HtmlDoc {
  const text = withoutComments(source);
  const doc: HtmlDoc = { module: false, forms: [], cdnPackages: [] };
  scripts(text, doc);
  forms(text, doc);
  return doc;
}
