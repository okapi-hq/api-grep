import type { ReadText } from "../ir/language.js";

/**
 * A Jupyter notebook (`.ipynb`) read as the Python of its code cells. The text handed to the grammar has the
 * notebook's line count: each source line sits on the line of the JSON string holding it (nbformat writes one per
 * line) and every other line is blank, so a call's line is its line in the notebook file.
 */

/** IPython syntax that is no Python: shell escapes (`!pip install`) and line magics (`%matplotlib inline`). */
const MAGIC_LINE = /^\s*[!%]/;
/** Cell magics whose body is Python; any other (`%%bash`, `%%html`, `%%sql`) makes the whole cell another language. */
const PYTHON_CELL_MAGICS = new Set(["time", "timeit", "capture", "prun", "debug"]);

interface Cell {
  cell_type?: unknown;
  source?: unknown;
}

interface Notebook {
  cells?: unknown;
  metadata?: { language_info?: { name?: unknown }; kernelspec?: { language?: unknown } };
}

function kernelLanguage(nb: Notebook): string {
  const lang = nb.metadata?.language_info?.name ?? nb.metadata?.kernelspec?.language ?? "python";
  return typeof lang === "string" ? lang.toLowerCase() : "python";
}

function cellIsPython(lines: string[]): boolean {
  const first = lines.find((l) => l.trim() !== "");
  const magic = first && /^\s*%%(\w+)/.exec(first);
  return !magic || PYTHON_CELL_MAGICS.has(magic[1]!);
}

/** The end of the JSON string starting at `start` (its opening quote): the index after its closing quote. */
function stringEnd(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
  return i + 1;
}

/** Index of the first non-blank, non-comma character from `i`. */
function skipSeparators(text: string, i: number): number {
  while (i < text.length && /[\s,]/.test(text[i]!)) i++;
  return i;
}

/** The 0-based line of each index, from the newline offsets. */
function lineOf(newlines: number[], index: number): number {
  let lo = 0;
  let hi = newlines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (newlines[mid]! < index) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The line each element of a cell's `source` array starts on, read from the raw text after the cell's `"source": [`;
 * undefined when the layout is not one string per line.
 */
function sourceLines(text: string, from: number, count: number, newlines: number[]): number[] | undefined {
  const lines: number[] = [];
  let i = from;
  for (let n = 0; n < count; n++) {
    i = skipSeparators(text, i);
    if (text[i] !== '"') return undefined;
    const line = lineOf(newlines, i);
    if (lines.length > 0 && lines[lines.length - 1] === line) return undefined;
    lines.push(line);
    i = stringEnd(text, i);
  }
  return lines;
}

/** Lines of the cell's code, 0-based, first and last; undefined for a cell that is no Python. */
function placeCell(out: string[], cell: string[], at: number[]): [number, number] | undefined {
  if (!cellIsPython(cell)) return undefined;
  cell.forEach((src, k) => {
    const line = src.replace(/\r?\n$/, "");
    if (!line.includes("\n") && !MAGIC_LINE.test(line)) out[at[k]!] = line;
  });
  return [at[0]!, at[at.length - 1]!];
}

/** Leaves out the cell holding a 1-based line (else the last one before it): its error would lose the notebook. */
function leaveOut(out: string[], cells: [number, number][]): (line: number) => string | undefined {
  return (line) => {
    const row = line - 1;
    let k = cells.length - 1;
    while (k >= 0 && cells[k]![0] > row) k--;
    if (k < 0) return undefined;
    const [first, last] = cells.splice(k, 1)[0]!;
    out.fill("", first, last + 1);
    return out.join("\n");
  };
}

/** The Python of each code cell, placed on the lines of its source strings; undefined when the layout does not allow it. */
function cellsPython(text: string, cells: Cell[], newlines: number[]): ReadText | undefined {
  // a key can hold no unescaped quote, so `"source": [` in the raw text is always a cell's key, in cell order
  const keys = [...text.matchAll(/"source"\s*:\s*\[/g)];
  if (keys.length !== cells.length || cells.some((c) => !Array.isArray(c.source))) return undefined;
  const out: string[] = new Array<string>(newlines.length + 1).fill("");
  const placed: [number, number][] = [];
  for (const [n, cell] of cells.entries()) {
    const source = cell.source as unknown[];
    if (cell.cell_type !== "code" || source.length === 0) continue;
    if (source.some((s) => typeof s !== "string")) return undefined;
    const at = sourceLines(text, keys[n]!.index + keys[n]![0].length, source.length, newlines);
    if (!at) return undefined;
    const lines = placeCell(out, source as string[], at);
    if (lines) placed.push(lines);
  }
  return { text: out.join("\n"), without: leaveOut(out, placed) };
}

/**
 * The Python a notebook runs, laid out on the notebook's lines (blank for a kernel of another language); `undefined`
 * for a file that is no notebook or a layout that would move lines (a `source` given as one string, several on a line).
 */
export function notebookPython(text: string): ReadText | undefined {
  let nb: Notebook;
  try {
    nb = JSON.parse(text) as Notebook;
  } catch {
    return undefined;
  }
  if (!nb || !Array.isArray(nb.cells)) return undefined;
  const newlines = [...text.matchAll(/\n/g)].map((m) => m.index);
  if (kernelLanguage(nb) !== "python") return { text: "\n".repeat(newlines.length) };
  return cellsPython(text, nb.cells as Cell[], newlines);
}
