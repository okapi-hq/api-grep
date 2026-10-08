import { CallSchema, type Call } from "./schema.js";

/** Validates each call on its own: one bad call is dropped (with a warning) instead of failing the whole report. */
export function validCalls(calls: Call[], onWarning?: (message: string) => void): Call[] {
  return calls.filter((c) => {
    const r = CallSchema.safeParse(c);
    if (!r.success) {
      const issue = r.error.issues[0];
      onWarning?.(`dropped call at ${c.location?.file}:${c.location?.line}: invalid ${issue?.path.join(".") || "call"} (${issue?.message ?? "schema"})`);
    }
    return r.success;
  });
}
