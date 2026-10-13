const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", s: " ", "\\": "\\", "'": "'", '"': '"', "\n": "" };

/** `\n`, `\"`, `A`, octal `\0` ... `\377`, and in text blocks `\s` and `\` before a line break (no break). */
export function unescapeJava(text: string): string {
  return text.replace(/\\(u+[0-9a-fA-F]{4}|[0-3]?[0-7]{1,2}|[\s\S])/g, (m, c: string) => {
    if (c.startsWith("u")) return String.fromCharCode(parseInt(c.replace(/^u+/, ""), 16));
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return ESCAPES[c] ?? m;
  });
}

/** `'a'`, `'\n'`. */
export function charValue(text: string): string {
  return unescapeJava(text.slice(1, -1));
}

/** `1_000L`, `0x1F`, `0b101`, `1.5f`, `2d`. */
export function numberValue(text: string): number {
  const t = text.replace(/_/g, "").replace(/[lL]$/, "");
  const v = /^0[xb]/i.test(t) ? Number(t.replace(/[pP].*$/, "")) : Number.parseFloat(t.replace(/[fFdD]$/, ""));
  return Number.isFinite(v) ? v : 0;
}

/**
 * The value of a text block (`"""` ... `"""`), as the compiler computes it: the line after the opening delimiter
 * starts the content, the indentation common to the content lines (and the closing line) is removed, trailing spaces
 * are stripped, then escapes are read.
 */
export function textBlock(literal: string): string {
  const body = literal.slice(3, -3);
  const start = body.indexOf("\n");
  const lines = (start >= 0 ? body.slice(start + 1) : "").split("\n").map((l) => l.replace(/\r$/, ""));
  const last = lines[lines.length - 1] ?? "";
  const significant = lines.filter((l, i) => l.trim() !== "" || (i === lines.length - 1 && last.trim() === ""));
  const indent = Math.min(...significant.map((l) => (l.trim() === "" ? l.length : l.length - l.trimStart().length)));
  const stripped = lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0).replace(/[ \t]+$/, ""));
  return unescapeJava(stripped.join("\n"));
}
