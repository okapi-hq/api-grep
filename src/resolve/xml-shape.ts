import { isSafeKey } from "../record-keys.js";
import type { DynamicPart, Part, Shape } from "../types.js";

/**
 * XML request bodies (#36): a SOAP envelope or any XML document the code writes as a string. The text comes from the
 * scanned repository, so the reader is small and strict: no DTD, no entity but the five predefined ones and character
 * references, a size, depth and element cap, and anything it does not understand makes the document unreadable (the
 * body stays an XML string). Each computed part of the text is a marker that cannot open or close an element.
 */

const MAX_TEXT = 64 * 1024;
const MAX_ELEMENTS = 500;
const MAX_DEPTH = 32;

/** `<n>`: the n-th computed part. Private-use characters, never markup. */
const HOLE_RE = /(\d+)/;
const ONLY_HOLE_RE = /^(\d+)$/;
const NAME_RE = /^[A-Za-z_][\w.:-]*$/;

/**
 * One token at a time from the current position (sticky): a comment, CDATA, a processing instruction, a declaration
 * (`<!DOCTYPE ...>`, skipped, never interpreted), a closing tag, an opening tag, or text. The alternatives inside
 * each token start with distinct characters, so matching stays linear.
 */
const TOKEN_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!(?:[^>[\]]|\[[^\]]*\])*>|<\/([^\s<>/]+)\s*>|<([^\s<>/!?]+)((?:[^<>"']|"[^"<]*"|'[^'<]*')*?)(\/?)>|([^<]+)/y;

interface Element {
  name: string;
  children: Element[];
  text: string;
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Predefined entities and character references; any other `&name;` stays as written. */
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m: string, ref: string) => {
    if (ref[0] !== "#") return ENTITIES[ref] ?? m;
    const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

interface Reader {
  stack: Element[];
  count: number;
}

/** Applies one token; false when the document is malformed or over a cap. */
function step(m: RegExpExecArray, r: Reader): boolean {
  const top = r.stack[r.stack.length - 1]!;
  const [, cdata, close, open, , selfClosing, text] = m;
  if (cdata !== undefined) top.text += cdata;
  else if (text !== undefined) {
    // only blank text outside the root element
    if (r.stack.length === 1 && text.trim() !== "") return false;
    top.text += decode(text);
  } else if (close !== undefined) {
    if (r.stack.length === 1 || top.name !== close) return false;
    r.stack.pop();
  } else if (open !== undefined) {
    if (++r.count > MAX_ELEMENTS || r.stack.length > MAX_DEPTH) return false;
    if (r.stack.length === 1 && top.children.length > 0) return false;
    const el: Element = { name: open, children: [], text: "" };
    top.children.push(el);
    if (!selfClosing) r.stack.push(el);
  }
  return true;
}

/** The root element of a document, or undefined when it cannot be read. */
function parse(text: string): Element | undefined {
  if (text.length > MAX_TEXT) return undefined;
  const doc: Element = { name: "", children: [], text: "" };
  const r: Reader = { stack: [doc], count: 0 };
  TOKEN_RE.lastIndex = 0;
  while (TOKEN_RE.lastIndex < text.length) {
    const m = TOKEN_RE.exec(text);
    if (!m || !step(m, r)) return undefined;
  }
  return r.stack.length === 1 && doc.children.length === 1 ? doc.children[0] : undefined;
}

function leafShape(el: Element, parts: Part[]): Shape {
  const t = el.text.trim();
  const hole = ONLY_HOLE_RE.exec(t);
  const part = hole ? parts[Number(hole[1])] : undefined;
  if (part && part.kind !== "static") return { type: "string", hint: part.name };
  return HOLE_RE.test(t) ? { type: "string" } : { type: "string", enum: [t] };
}

/** An element's shape: its text, or an object of its child elements (a repeated one is an array). */
function elementShape(el: Element, parts: Part[]): Shape {
  if (el.children.length === 0) return leafShape(el, parts);
  const properties: Record<string, Shape> = {};
  let dynamicKeys = false;
  for (const child of el.children) {
    if (HOLE_RE.test(child.name) || !NAME_RE.test(child.name) || !isSafeKey(child.name)) {
      dynamicKeys = true;
      continue;
    }
    const prev = Object.hasOwn(properties, child.name) ? properties[child.name] : undefined;
    properties[child.name] = prev ? (prev.type === "array" ? prev : { type: "array", items: prev }) : elementShape(child, parts);
  }
  return { type: "object", properties, required: Object.keys(properties), ...(dynamicKeys ? { dynamicKeys } : {}) };
}

/** Text with each computed part as a marker. */
function markedText(parts: Part[]): string {
  return parts.map((p, i) => (p.kind === "static" ? p.text : `${i}`)).join("");
}

/** Text that starts as an XML document (a declaration or an element) and ends with markup. */
export function looksLikeXml(text: string): boolean {
  const t = text.trim();
  return /^<(?:\?xml\s|[A-Za-z_][\w.:-]*[\s/>])/.test(t) && t.endsWith(">");
}

/**
 * The body shape of a string built from parts when it is an XML document: an object holding the root element, whose
 * value holds its child elements, down to the text of the leaves (a literal value, or the computed part's name as
 * `hint`). Attributes and namespace declarations are left out. A document too large or unusual to read is a plain
 * `string`; undefined when the text is not XML.
 */
export function xmlBodyShape(parts: Part[]): Shape | undefined {
  const text = markedText(parts);
  if (!looksLikeXml(text)) return undefined;
  const root = parse(text.trim());
  if (!root || !NAME_RE.test(root.name) || !isSafeKey(root.name)) return { type: "string" };
  return { type: "object", properties: { [root.name]: elementShape(root, parts) }, required: [root.name] };
}

/** An XML body from the parts of a string: its shape, and each computed part as a dynamic part of the body. */
export function xmlBody(parts: Part[]): { shape: Shape; dynamic: DynamicPart[] } | undefined {
  const shape = xmlBodyShape(parts);
  if (!shape) return undefined;
  const dynamic = parts.flatMap((p): DynamicPart[] =>
    p.kind === "dynamic" ? [{ where: "body", name: p.name, origin: p.origin }] : p.kind === "env" ? [{ where: "body", name: p.name, origin: "env" }] : [],
  );
  return { shape, dynamic };
}

/** `text/xml`, `application/xml`, `application/soap+xml`, `application/atom+xml; charset=utf-8`. */
export function isXmlContentType(value: string | null | undefined): boolean {
  return !!value && /^\s*(?:text|application)\/(?:[\w.-]+\+)?xml\s*(?:;|$)/i.test(value);
}
