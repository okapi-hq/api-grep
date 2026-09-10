const SECRET_PATTERNS: RegExp[] = [
  /\bsk_(live|test)_[A-Za-z0-9]{8,}/,
  /\brk_(live|test)_[A-Za-z0-9]{8,}/,
  /\bpk_(live|test)_[A-Za-z0-9]{8,}/,
  /\bwhsec_[A-Za-z0-9]{8,}/,
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAC[0-9a-f]{32}\b/,
  /\bSK[0-9a-f]{32}\b/,
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b[0-9a-f]{32,}\b/i,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export function looksSecret(s: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(s));
}

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
