import { z } from "zod/v4";
import { ReportSchema, SCHEMA_URL } from "./schema.js";

type JsonSchema = Record<string, unknown>;

/** `{ allOf: [{ $ref }] }`, what an optional or described reference becomes, back to `{ $ref }` plus its own keys. */
function inlineSingleRef(node: JsonSchema): void {
  const all = node.allOf as JsonSchema[] | undefined;
  if (all?.length !== 1 || typeof all[0]?.$ref !== "string") return;
  delete node.allOf;
  node.$ref = all[0].$ref;
}

/**
 * The report contract as a draft-07 JSON Schema, generated from `ReportSchema`. Objects stay open (no
 * `additionalProperties: false`) so a reader built against 1.0 still validates a 1.1 report that adds fields.
 */
export function reportJsonSchema(): JsonSchema {
  const schema = z.toJSONSchema(ReportSchema, {
    target: "draft-7",
    io: "output",
    override: ({ jsonSchema }) => {
      const node = jsonSchema as JsonSchema;
      if (node.additionalProperties === false) delete node.additionalProperties;
      delete node.id;
      inlineSingleRef(node);
    },
  }) as JsonSchema;
  const { $schema, ...rest } = schema;
  return { $schema, $id: SCHEMA_URL, ...rest };
}
