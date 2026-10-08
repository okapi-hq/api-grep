import { CallSchema, type Call, type DroppedCall } from "./schema.js";

/** Validates each call on its own: a call that does not fit the schema is set aside instead of failing the whole report. */
export function splitValid(calls: Call[]): { valid: Call[]; dropped: DroppedCall[] } {
  const valid: Call[] = [];
  const dropped: DroppedCall[] = [];
  for (const c of calls) {
    const r = CallSchema.safeParse(c);
    if (r.success) {
      valid.push(c);
      continue;
    }
    const issue = r.error.issues[0];
    const detail = `${issue?.path.join(".") || "call"}: ${issue?.message ?? "invalid"}`;
    dropped.push({ file: c.location?.file ?? "?", line: c.location?.line ?? 0, reason: "schema-invalid", detail });
  }
  return { valid, dropped };
}
