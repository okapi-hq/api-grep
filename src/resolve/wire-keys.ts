import type { DynamicPart, SdkMatch, Shape } from "../types.js";
import type { QueryResult } from "./query.js";

/**
 * Keys an SDK sends otherwise than the code writes them. Fern-generated clients (`cohere-ai`, `@elevenlabs/elevenlabs-js`)
 * take camel case keys and send snake case (`modelId` is `model_id`: `wireCase`), and read some keys of the request
 * object as query parameters (`outputFormat`: `queryKeys`).
 */

/** `modelId` -> `model_id`; a key that is no identifier (`...spread`) is left as it is. */
const snake = (k: string): string => (/^[a-z][A-Za-z0-9]*$/.test(k) ? k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`) : k);

/** Keys whose values are free-form maps the library sends as written (a JSON schema, documents, metadata). */
const AS_WRITTEN = new Set(["documents", "data", "parameters", "parameterDefinitions", "schema", "jsonSchema", "metadata", "dynamicVariables", "webhookMetadata"]);

function snakeShape(s: Shape, depth = 0): Shape {
  if (depth > 8) return s;
  if (s.type === "array") return { ...s, items: snakeShape(s.items, depth + 1) };
  if (s.type === "union") return { ...s, anyOf: s.anyOf.map((m) => snakeShape(m, depth + 1)) };
  if (s.type !== "object") return s;
  const properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [snake(k), AS_WRITTEN.has(k) ? v : snakeShape(v, depth + 1)]));
  return { ...s, properties, required: s.required.map(snake) };
}

const snakeDynamic = (d: DynamicPart): DynamicPart => (d.where === "body" || d.where === "query" ? { ...d, name: snake(d.name) } : d);

/** Moves the `keys` of the body to the query, the library sending them there. */
function moveToQuery(body: { shape?: Shape; dynamic: DynamicPart[] }, q: QueryResult, keys: string[]): void {
  const shape = body.shape;
  if (shape?.type !== "object") return;
  const moved = keys.filter((k) => k in shape.properties);
  if (moved.length === 0) return;
  for (const k of moved) {
    if (!q.names.includes(k)) q.names.push(k);
    q.shape[k] = shape.properties[k]!;
  }
  const properties = Object.fromEntries(Object.entries(shape.properties).filter(([k]) => !moved.includes(k)));
  body.shape = { ...shape, properties, required: shape.required.filter((k) => k in properties) };
  for (const d of body.dynamic) if (d.where === "body" && moved.includes(d.name)) q.dynamic.push({ ...d, where: "query" });
  body.dynamic = body.dynamic.filter((d) => d.where !== "body" || !moved.includes(d.name));
}

/** The query without the keys of the params object the library puts in the path (`bodyOmit`). */
function omitQueryKeys(q: QueryResult, keys: string[]): void {
  q.names = q.names.filter((k) => !keys.includes(k));
  q.shape = Object.fromEntries(Object.entries(q.shape).filter(([k]) => !keys.includes(k)));
  q.dynamic = q.dynamic.filter((d) => d.where !== "query" || !keys.includes(d.name));
}

/** The body and query as the SDK sends them (`bodyOmit`, `queryKeys`, `wireCase`). */
export function sentAsWire(sdk: SdkMatch | undefined, body: { shape?: Shape; dynamic: DynamicPart[] }, q: QueryResult): void {
  if (sdk?.spec.bodyOmit?.length) omitQueryKeys(q, sdk.spec.bodyOmit);
  if (sdk?.spec.queryKeys?.length) moveToQuery(body, q, sdk.spec.queryKeys);
  if (sdk?.wireCase !== "snake") return;
  if (body.shape) body.shape = snakeShape(body.shape);
  body.dynamic = body.dynamic.map(snakeDynamic);
  q.names = q.names.map(snake);
  q.shape = Object.fromEntries(Object.entries(q.shape).map(([k, v]) => [snake(k), snakeShape(v)]));
  q.dynamic = q.dynamic.map(snakeDynamic);
}
