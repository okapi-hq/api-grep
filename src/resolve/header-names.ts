import { isCredentialHeader, looksSecret } from "../secrets.js";
import type { AuthScheme, Part } from "../types.js";
import { staticText } from "./parts.js";

export interface HeadersResult {
  names: string[];
  /** Static literal values for non-credential headers; `null` when the value is dynamic or a credential. */
  values: Record<string, string | null>;
  /** Every literal value of a header that can take several (a parameter's default and its callers' arguments, #39). */
  alternatives?: Record<string, string[]>;
  authScheme: AuthScheme;
  known: boolean;
}

export const APIKEY_HEADERS = new Set(["x-api-key", "api-key", "apikey", "x-auth-token", "x-token", "api_key", "x-access-token", "x-goog-api-key", "anthropic-api-key"]);

/** `Bearer ...` / `Basic ...` / `token ...` at the start of an Authorization value. */
export function schemeFromAuthValue(value: Part[] | undefined): AuthScheme {
  const first = value?.[0];
  const head = first?.kind === "static" ? first.text.trim().toLowerCase() : "";
  if (head.startsWith("bearer")) return "bearer";
  if (head.startsWith("basic")) return "basic";
  if (head.startsWith("token")) return "apikey";
  return "unknown";
}

function staticValue(lower: string, value: Part[] | undefined): string | null {
  if (!value || isCredentialHeader(lower)) return null;
  const text = staticText(value);
  if (text === undefined || looksSecret(text)) return null;
  return text;
}

/**
 * A header whose value is a parameter: the first literal value, null when one cannot be read; every literal value in
 * `alternatives` when it can take more than one.
 */
function recordAlternatives(out: HeadersResult, lower: string, alternatives: (Part[] | undefined)[]): void {
  const values = alternatives.map((a) => staticValue(lower, a));
  const known = [...new Set(values.filter((v): v is string => v !== null))];
  const unread = values.includes(null);
  out.values[lower] = unread ? null : (known[0] ?? null);
  if (known.length > 1 || (unread && known.length > 0)) out.alternatives = { ...out.alternatives, [lower]: known };
  else if (out.alternatives) delete out.alternatives[lower];
}

/**
 * Records one header (name lower-cased): its literal value unless it is a credential, and the auth scheme it implies.
 * `alternatives` are the values it takes when it is a parameter of the enclosing function.
 */
export function addHeader(out: HeadersResult, key: string, value: Part[] | undefined, alternatives?: (Part[] | undefined)[]): void {
  const lower = key.toLowerCase();
  if (!out.names.includes(lower)) out.names.push(lower);
  if (alternatives?.length) recordAlternatives(out, lower, alternatives);
  else {
    out.values[lower] = staticValue(lower, value);
    if (out.alternatives) delete out.alternatives[lower];
  }
  if (lower === "authorization") {
    const s = value ? schemeFromAuthValue(value) : "unknown";
    if (out.authScheme === "none" || out.authScheme === "unknown") out.authScheme = s;
  } else if (APIKEY_HEADERS.has(lower)) out.authScheme = "apikey";
}
