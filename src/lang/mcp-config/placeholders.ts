import type { Part } from "../../types.js";

/**
 * A configuration value as the tool reads it: environment placeholders (`${env:X}` in VS Code, Cursor and Windsurf,
 * `${X}` and `${X:-default}` in Claude Code, `{env:X}` in opencode) are env reads, a VS Code input (`${input:id}`,
 * asked of the user) a value known at run time only; the rest is literal text.
 */

const NAME = "[A-Za-z_][A-Za-z0-9_]*";
const PLACEHOLDER = new RegExp(`\\$\\{env:(${NAME})\\}|\\$\\{(${NAME})(?::-([^}]*))?\\}|\\{env:(${NAME})\\}|\\$\\{input:([A-Za-z0-9_.-]+)\\}`, "g");

/** The parts of a configuration string. */
export function valueParts(text: string): Part[] {
  const out: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m.index > last) out.push({ kind: "static", text: text.slice(last, m.index) });
    const env = m[1] ?? m[2] ?? m[4];
    if (env !== undefined) out.push({ kind: "env", name: env, ...(m[3] ? { fallback: m[3] } : {}) });
    else out.push({ kind: "dynamic", name: m[5]!, origin: "unknown" });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "static", text: text.slice(last) });
  return out;
}

/** An env var's value as a part (Codex's `env_http_headers`, `bearer_token_env_var`). */
export const envPart = (name: string): Part => ({ kind: "env", name });
