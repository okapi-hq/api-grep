/**
 * C0 / C1 control characters and the bidirectional overrides of "Trojan Source". The scanned repository chooses the
 * strings a report prints (paths, URLs, header values), so none of these may reach a terminal or a shell script raw.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** `s` on one printable line: unsafe characters become `\uXXXX` escapes (a newline cannot start a new shell command). */
export function printable(s: string): string {
  return s.replace(UNSAFE_CHARS, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
