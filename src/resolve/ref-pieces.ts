import type { Part } from "../types.js";

/** How a `params` source is read: its value, and the parts of an expression. */
interface ValueReader<E> {
  param(source: string, name: string): { expr?: E; parts?: Part[] } | undefined;
  evaluate(e: E): Part[];
}

type Value<E> = { expr?: E; parts?: Part[] };

/** `arg:0#1`: piece N of the `owner/name:version` reference a source holds (Replicate). */
const REF_PIECE = /^(.+)#([012])$/;
const REF_SEPARATORS = ["/", ":"];

/** `arg:0#.-1`, `arg:0#/-5`: piece N from the end of an id the separator joins (BigQuery's `project.dataset.table`). */
const ID_PIECE = /^(.+)#([./])(-[1-9])$/;

const has = <E>(v: Value<E> | undefined): boolean => v?.expr !== undefined || v?.parts !== undefined;

/**
 * A reference split at its first `/` and the first `:` after it, as Replicate's SDKs parse it. One value the scan cannot
 * read (`run(ref)`) holds the owner and the name, not a version the code is known to give.
 */
function refPieces(parts: Part[]): Part[][] {
  if (parts.length === 1 && parts[0]!.kind !== "static") return [parts, parts];
  const pieces: Part[][] = [[]];
  for (const p of parts) {
    if (p.kind !== "static") {
      pieces[pieces.length - 1]!.push(p);
      continue;
    }
    let text = p.text;
    for (;;) {
      const sep = REF_SEPARATORS[pieces.length - 1];
      const at = sep ? text.indexOf(sep) : -1;
      if (at < 0) break;
      if (at > 0) pieces[pieces.length - 1]!.push({ kind: "static", text: text.slice(0, at) });
      pieces.push([]);
      text = text.slice(at + 1);
    }
    if (text) pieces[pieces.length - 1]!.push({ kind: "static", text });
  }
  return pieces;
}

/**
 * An id split at every separator of its literal text; undefined when a value the scan cannot read holds no separator
 * the code writes (`get_table(table_id)`): that value may be the whole id, so no piece of it is known.
 */
function idPieces(parts: Part[], sep: string): Part[][] | undefined {
  const pieces: Part[][] = [[]];
  for (const p of parts) {
    if (p.kind !== "static") {
      pieces[pieces.length - 1]!.push(p);
      continue;
    }
    p.text.split(sep).forEach((text, i) => {
      if (i > 0) pieces.push([]);
      if (text) pieces[pieces.length - 1]!.push({ kind: "static", text });
    });
  }
  return pieces.length === 1 && parts.some((p) => p.kind !== "static") ? undefined : pieces;
}

function partsOf<E>(src: ValueReader<E>, value: Value<E> | undefined): Part[] | undefined {
  return value?.parts ?? (value?.expr !== undefined ? src.evaluate(value.expr) : undefined);
}

/**
 * One alternative of an id-piece source: the piece's parts; undefined when the id has no such piece (`dataset.table`
 * names no project: the next alternative says which); `null` when the id cannot be split, which ends the search.
 */
function idPiece<E>(src: ValueReader<E>, alt: string, name: string): Value<E> | undefined | null {
  const m = ID_PIECE.exec(alt);
  if (!m) return src.param(alt, name);
  const value = src.param(m[1]!, name);
  if (!has(value)) return undefined;
  const pieces = idPieces(partsOf(src, value)!, m[2]!);
  if (!pieces) return null;
  const out = pieces[pieces.length + Number(m[3])];
  return out?.length ? { parts: out } : undefined;
}

/**
 * The value of a `params` source; `#N` after it reads piece N of the reference it holds; `#.-N` / `#/-N`, in each
 * `|` alternative, piece N from the end of the id it holds, the next alternative giving the value when there is none.
 */
export function sourceValue<E>(src: ValueReader<E>, source: string, name: string): Value<E> | undefined {
  if (source.includes("#.") || source.includes("#/")) {
    for (const alt of source.split("|")) {
      const v = idPiece(src, alt, name);
      if (v === null) return {};
      if (has(v)) return v;
    }
    return {};
  }
  const piece = REF_PIECE.exec(source);
  if (!piece) return src.param(source, name);
  const value = src.param(piece[1]!, name);
  const parts = partsOf(src, value);
  if (!parts) return value;
  const out = refPieces(parts)[Number(piece[2])];
  return out?.length ? { parts: out } : {};
}
