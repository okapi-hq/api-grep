import { looksSecret } from "../report/redact.js";
import type { AuthScheme, Part } from "../types.js";
import { staticText } from "./parts.js";

export interface HeadersResult {
  names: string[];
  /** Static literal values for non-credential headers; `null` when the value is dynamic or a credential. */
  values: Record<string, string | null>;
  authScheme: AuthScheme;
  known: boolean;
}

export const APIKEY_HEADERS = new Set(["x-api-key", "api-key", "apikey", "x-auth-token", "x-token", "api_key", "x-access-token", "x-goog-api-key", "anthropic-api-key"]);
const CREDENTIAL_RE = /^(authorization|proxy-authorization|cookie|set-cookie)$|token|key|secret|password|credential|session|signature/;

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
  if (!value || CREDENTIAL_RE.test(lower)) return null;
  const text = staticText(value);
  if (text === undefined || looksSecret(text)) return null;
  return text;
}

/** Records one header (name lower-cased): its literal value unless it is a credential, and the auth scheme it implies. */
export function addHeader(out: HeadersResult, key: string, value: Part[] | undefined): void {
  const lower = key.toLowerCase();
  if (!out.names.includes(lower)) out.names.push(lower);
  out.values[lower] = staticValue(lower, value);
  if (lower === "authorization") {
    const s = value ? schemeFromAuthValue(value) : "unknown";
    if (out.authScheme === "none" || out.authScheme === "unknown") out.authScheme = s;
  } else if (APIKEY_HEADERS.has(lower)) out.authScheme = "apikey";
}
