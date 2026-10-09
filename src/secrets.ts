import type { Shape } from "./types.js";

/**
 * What counts as a secret, in one place: values that look like credentials (redacted from every string of a report)
 * and names that hold credentials (their literal values are never reported; examples get `<name>` placeholders).
 *
 * The patterns run on strings the scanned code chooses: none may backtrack quadratically. A pattern whose run of
 * characters is followed by a required token starts with a lookbehind, so it is tried once per run, not once per
 * position (`ey-ey-ey-…` made the JWT rule take seconds per string).
 */

const SECRET_PATTERNS: RegExp[] = [
  /\bsk_(live|test)_[A-Za-z0-9]{8,}/,
  /\brk_(live|test)_[A-Za-z0-9]{8,}/,
  /\bpk_(live|test)_[A-Za-z0-9]{8,}/,
  /\bwhsec_[A-Za-z0-9]{8,}/,
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bhooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{16,}/,
  /\bAC[0-9a-f]{32}\b/,
  /\bSK[0-9a-f]{32}\b/,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/,
  /\bnpm_[A-Za-z0-9]{36}\b/,
  /\bhf_[A-Za-z0-9]{30,}/,
  /\bya29\.[A-Za-z0-9_-]{20,}/,
  /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/,
  /(?<![A-Za-z0-9_-])ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b[0-9a-f]{32,}\b/i,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,30}:\/\/[^/?#@\s:]{1,256}:[^/?#@\s]{1,256}@/i,
];

/** Header names whose values are credentials or session state: their literal values are never reported. */
const CREDENTIAL_HEADER_RE = /^(authorization|proxy-authorization|cookie|set-cookie)$|token|key|secret|password|credential|session|signature/;

/** Property and parameter names that hold a credential (`password`, `client_secret`, `api-key`). */
const CREDENTIAL_KEY_RE = /(^|_|-)(token|secret|password|passwd|api[-_]?key|apikey|credential|private[-_]?key|access[-_]?key)($|_|-)|^key$|authorization/i;
/** Names ending in a credential word (`accessToken`, `authtoken`, `clientSecret`, `secretkey`). */
const CREDENTIAL_SUFFIX_RE = /[a-z0-9](token|secret|password|passwd)$|(secret|private|access|api|auth)key$/i;
/** camelCase `...Key` (`apiKey`, `signingKey`): case-sensitive, so `monkey` is not one. */
const CAMEL_KEY_RE = /[a-z0-9]Key$/;

export function looksSecret(s: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(s));
}

export function isCredentialHeader(name: string): boolean {
  return CREDENTIAL_HEADER_RE.test(name.toLowerCase());
}

export function isCredentialKey(key: string): boolean {
  return CREDENTIAL_KEY_RE.test(key) || CREDENTIAL_SUFFIX_RE.test(key) || CAMEL_KEY_RE.test(key);
}

/** `https://user:p@ss@host/x` -> `https://host/x` (up to the last `@` of the authority): URL credentials never reach the host or the template. */
export function stripUserinfo(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, "$1");
}

/** `?api_key=abc123&page=2` -> `?api_key=<redacted>&page=2`; placeholders (`{key}`) are kept. */
export function maskCredentialQuery(url: string): string {
  return url.replace(/([?&])([^=&#]+)=([^&#]*)/g, (m: string, sep: string, key: string, value: string) =>
    isCredentialKey(key) && value !== "" && !/^\{[^}]+\}$/.test(value) ? `${sep}${key}=<redacted>` : m,
  );
}

/** Everything under a credential-named property loses its literal values (`{ token: ["ghp_x"] }`, `{ api_key: { value } }`). */
function withoutLiterals(s: Shape): Shape {
  switch (s.type) {
    case "string":
    case "number":
    case "integer":
    case "boolean": {
      const rest = { ...s };
      delete rest.enum;
      return rest;
    }
    case "union":
      return { ...s, anyOf: s.anyOf.map(withoutLiterals) };
    case "array":
      return { ...s, items: withoutLiterals(s.items) };
    case "object":
      return { ...s, properties: Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, withoutLiterals(v)])) };
    default:
      return s;
  }
}

/** `{ password: "hunter2" }` keeps the property and its type, not the literal value; nested objects included. */
export function withoutCredentialLiterals<S extends Shape | undefined>(shape: S): S {
  if (!shape) return shape;
  const s: Shape = shape;
  switch (s.type) {
    case "object": {
      const properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, isCredentialKey(k) ? withoutLiterals(v) : withoutCredentialLiterals(v)]));
      return { ...s, properties } as S;
    }
    case "array":
      return { ...s, items: withoutCredentialLiterals(s.items) } as S;
    case "union":
      return { ...s, anyOf: s.anyOf.map((x) => withoutCredentialLiterals(x)) } as S;
    default:
      return shape;
  }
}
