import type { Expression } from "ts-morph";
import type { BodyEncoding, DynamicPart, EvalCtx, Shape } from "../types.js";
import { shapeOf, type BodyResult } from "./body.js";

/**
 * A body an SDK builds from positional arguments (`bot.sendMessage(chatId, text, options)` sends `chat_id`, `text`
 * and the options' keys): the fields given, then those of the options object, which win on a clash.
 */
export function withFieldArgs(body: BodyResult, fields: string[], args: (Expression | undefined)[], ctx: EvalCtx, encoding: BodyEncoding): BodyResult {
  const properties: Record<string, Shape> = {};
  const required: string[] = [];
  const dynamic: DynamicPart[] = [...body.dynamic];
  let fromLiteral = true;
  fields.forEach((name, i) => {
    const arg = args[i];
    if (!name || !arg) return;
    const r = shapeOf(arg, ctx, 0, dynamic);
    properties[name] = r.shape;
    required.push(name);
    fromLiteral &&= r.fromLiteral;
  });
  if (required.length === 0) return body;
  const own = body.shape;
  if (own?.type === "object") {
    const shape: Shape = { ...own, properties: { ...properties, ...own.properties }, required: [...required, ...own.required.filter((r) => !required.includes(r))] };
    return { ...body, shape, dynamic };
  }
  // options the scan cannot read add keys it does not know
  const opaque = !!own && own.type !== "null";
  const shape: Shape = { type: "object", properties, required, ...(opaque ? { dynamicKeys: true } : {}) };
  return { shape, encoding: body.encoding === "none" ? encoding : body.encoding, dynamic, fromLiteral: fromLiteral && body.fromLiteral !== false };
}
