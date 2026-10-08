import { looksSecret } from "../secrets.js";

/** Deep-walks any JSON value replacing secret-looking strings with `<redacted>`; returns the count replaced. */
export function redact<T>(value: T): { value: T; count: number } {
  let count = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (looksSecret(v)) {
        count++;
        return "<redacted>";
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[looksSecret(k) ? "<redacted>" : k] = walk(x);
      return out;
    }
    return v;
  };
  return { value: walk(value) as T, count };
}
