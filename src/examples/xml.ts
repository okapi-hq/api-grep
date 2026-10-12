/**
 * An example XML body from the values synthesized for its shape (`src/resolve/xml-shape.ts`): each key an element,
 * an array a repeated element, anything else the element's text. A string body is sent as it is.
 */

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function elements(name: string, value: unknown, depth: number): string {
  if (Array.isArray(value)) return value.map((v) => elements(name, v, depth)).join("");
  return `<${name}>${content(value, depth + 1)}</${name}>`;
}

function content(value: unknown, depth: number): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return escapeText(String(value));
  if (value === null || typeof value !== "object") return "";
  // shapes are depth-capped; this only guards a malformed value
  if (depth > 64) return "";
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => elements(k, v, depth))
    .join("");
}

export function toXml(value: unknown): string {
  if (typeof value === "string") return value;
  return `<?xml version="1.0" encoding="UTF-8"?>${content(value, 0)}`;
}
