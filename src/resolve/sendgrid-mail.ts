import type { MethodSpec, Shape } from "../types.js";

/**
 * `@sendgrid/mail`'s `send(data)` does not send `data`: `Mail.create(data).toJSON()` (`@sendgrid/helpers`) reads the keys
 * it knows (camel or snake case), puts `to` / `cc` / `bcc` / `dynamicTemplateData` in a personalization, `text` / `html`
 * in `content`, addresses as `{ email }`, and sends the result in snake case. This is that conversion on the shape of
 * `data`; a value that is no object is left as it is, and keys the library does not know are not sent.
 */

const obj = (properties: Record<string, Shape>, required: string[]): Shape => ({ type: "object", properties, required });

const camel = (k: string): string => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const snake = (k: string): string => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Keys whose values the library sends as written (template data, custom args, headers). */
const AS_WRITTEN = new Set(["substitutions", "dynamicTemplateData", "customArgs", "headers", "sections"]);

function snakeKeys(s: Shape, depth = 0): Shape {
  if (depth > 8) return s;
  if (s.type === "array") return { ...s, items: snakeKeys(s.items, depth + 1) };
  if (s.type === "union") return { ...s, anyOf: s.anyOf.map((m) => snakeKeys(m, depth + 1)) };
  if (s.type !== "object") return s;
  const entries = Object.entries(s.properties).map(([k, v]) => [snake(camel(k)), AS_WRITTEN.has(camel(k)) ? v : snakeKeys(v, depth + 1)] as const);
  return { ...s, properties: Object.fromEntries(entries), required: s.required.map((k) => snake(camel(k))) };
}

/** An address: a string is `{ email }`, an object is sent with its keys in snake case; anything else as it is. */
function address(s: Shape): Shape {
  if (s.type === "string") return obj({ email: s }, ["email"]);
  if (s.type === "union") return { ...s, anyOf: s.anyOf.map(address) };
  return snakeKeys(s);
}

/** `to` / `cc` / `bcc`: always a list of addresses. */
function addresses(s: Shape): Shape {
  return { type: "array", items: s.type === "array" ? address(s.items) : address(s) };
}

const PERSONAL = ["to", "cc", "bcc"];

function personalization(p: Record<string, Shape>, required: Set<string>): Shape {
  const out: Record<string, Shape> = {};
  for (const [k, v] of Object.entries(p)) {
    if (PERSONAL.includes(k)) out[k] = addresses(v);
    else if (k === "dynamicTemplateData" || k === "customArgs" || k === "headers") out[snake(k)] = v;
    else if (k === "subject" || k === "sendAt") out[snake(k)] = v;
    else if (k === "substitutions") out[k] = { type: "object", properties: {}, required: [], dynamicKeys: true };
  }
  return obj(out, Object.keys(p).filter((k) => required.has(k) && snake(k) in out).map(snake));
}

/** The keys of a personalization given at the top level of `data`. */
const TOP_PERSONAL = ["to", "cc", "bcc", "dynamicTemplateData", "substitutions"];
const SIMPLE = ["subject", "sendAt", "batchId", "templateId", "ipPoolName", "asm", "mailSettings", "trackingSettings", "customArgs", "headers", "sections", "attachments", "categories"];

function contents(props: Record<string, Shape>): Shape | undefined {
  const items: Shape[] = [];
  if (props.content?.type === "array") items.push(snakeKeys(props.content.items));
  if (props.text) items.push(obj({ type: { type: "string", enum: ["text/plain"] }, value: props.text }, ["type", "value"]));
  if (props.html) items.push(obj({ type: { type: "string", enum: ["text/html"] }, value: props.html }, ["type", "value"]));
  if (items.length === 0) return undefined;
  return { type: "array", items: items.length === 1 ? items[0]! : { type: "union", anyOf: items } };
}

function personalizations(props: Record<string, Shape>, required: Set<string>): Shape | undefined {
  const given = props.personalizations;
  if (given?.type === "array" && given.items.type === "object") {
    const item = given.items;
    const req = new Set(item.required.map(camel));
    return { type: "array", items: personalization(Object.fromEntries(Object.entries(item.properties).map(([k, v]) => [camel(k), v])), req) };
  }
  if (given) return given;
  const top = Object.fromEntries(Object.entries(props).filter(([k]) => TOP_PERSONAL.includes(k)));
  return Object.keys(top).length > 0 ? { type: "array", items: personalization(top, required) } : undefined;
}

function mailBody(s: Extract<Shape, { type: "object" }>): Shape {
  const props = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [camel(k), v]));
  const required = new Set(s.required.map(camel));
  const out: Record<string, Shape> = {};
  const req: string[] = [];
  const put = (key: string, value: Shape | undefined, from: string[]): void => {
    if (!value) return;
    out[key] = value;
    if (from.some((k) => required.has(k))) req.push(key);
  };
  put("from", props.from && address(props.from), ["from"]);
  put("reply_to", props.replyTo && address(props.replyTo), ["replyTo"]);
  put("reply_to_list", props.replyToList && addresses(props.replyToList), ["replyToList"]);
  put("personalizations", personalizations(props, required), ["personalizations", ...TOP_PERSONAL]);
  put("content", contents(props), ["content", "text", "html"]);
  for (const k of SIMPLE) put(snake(k), props[k] && (AS_WRITTEN.has(k) ? props[k] : snakeKeys(props[k])), [k]);
  if (!out.categories && props.category) put("categories", { type: "array", items: props.category }, ["category"]);
  return obj(out, req);
}

/** The body a library sends for the body argument's shape (`MethodSpec.bodyConvert`); an array is one request per item. */
export function convertedBody(shape: Shape | undefined, convert: MethodSpec["bodyConvert"]): Shape | undefined {
  if (!shape || convert !== "sendgrid-mail") return shape;
  const one = (s: Shape): Shape => (s.type === "object" ? mailBody(s) : s.type === "union" ? { ...s, anyOf: s.anyOf.map(one) } : s);
  return shape.type === "array" ? one(shape.items) : one(shape);
}
