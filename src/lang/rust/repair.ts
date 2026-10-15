/**
 * Rewrites of valid Rust the grammar does not parse, each the same length (no position moves); tried only on a file
 * that does not parse as written, and kept only when the rewrite parses:
 * - `&raw` borrowing a variable named `raw` (`f(&raw)`) reads as the start of a raw borrow (`&raw const x`): written
 *   `*raw`, which lowers to the same value;
 * - a `#[cfg(...)]` attribute on a field of a struct pattern or literal (`let Config { #[cfg(x)] tls, .. } = c;`) is
 *   blanked.
 */

const RAW_BORROW = /(^|[\s(,=[{])&raw(?=[\s).,[;}])(?!\s+(?:const|mut)\b)/g;
const FIELD_CFG = /#\[cfg(?:_attr)?\((?:[^[\]()]|\([^()]*\))*\)\](?=\s*[a-z_][a-z0-9_]*\s*[,}:])/g;

export function repairRust(text: string): string {
  return text.replace(RAW_BORROW, (_m, before: string) => `${before}*raw`).replace(FIELD_CFG, (m) => " ".repeat(m.length));
}
