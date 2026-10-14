import { readFileSync, statSync } from "node:fs";

/**
 * The reference inventory: one row per call site. `repo`, `file` (relative to the repository root) and `line` are
 * required; `service` (who the call talks to), `kind` (`third-party` or `internal`) and `target` (a host, an SDK
 * method: never read) are optional. Format and rules: eval/README.md.
 */
export interface InventoryEntry {
  repo: string;
  file: string;
  line: number;
  service: string;
  kind: string;
}

export interface Inventory {
  entries: InventoryEntry[];
  /** Rows without a repository, a file or a positive line. */
  rejected: number;
}

const MAX_INVENTORY_BYTES = 64 * 1024 * 1024;
const MAX_ROWS = 500_000;

/**
 * A regular file of at most `maxBytes`, as text. The inventory and the reports come from outside this repository: a
 * symlink to `/dev/zero` or a huge file is refused instead of read.
 */
export function readBounded(file: string, maxBytes: number): string {
  const st = statSync(file, { throwIfNoEntry: false });
  if (!st?.isFile()) throw new Error("not a regular file");
  if (st.size > maxBytes) throw new Error(`larger than ${maxBytes} bytes`);
  return readFileSync(file, "utf8");
}

/** RFC 4180 CSV: quoted cells may hold commas, quotes (`""`) and newlines; CRLF line ends are accepted. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endCell = (): void => {
    row.push(cell);
    cell = "";
  };
  const endRow = (): void => {
    endCell();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted && ch === '"' && text[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') quoted = !quoted;
    else if (quoted) cell += ch;
    else if (ch === ",") endCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Repository-relative, `/` separated, without a leading `./` or `/`: the form report locations use. */
export function normalizeFile(file: string): string {
  return file.trim().replace(/\\/g, "/").replace(/^(?:\.\/|\/)+/, "");
}

function entryOf(raw: Record<string, unknown>): InventoryEntry | undefined {
  const text = (k: string): string => (typeof raw[k] === "string" || typeof raw[k] === "number" ? String(raw[k]).trim() : "");
  const line = Number(text("line"));
  const entry = { repo: text("repo"), file: normalizeFile(text("file")), line, service: text("service"), kind: text("kind").toLowerCase() };
  return entry.repo && entry.file && Number.isSafeInteger(line) && line > 0 ? entry : undefined;
}

function csvRecords(text: string): Record<string, unknown>[] {
  const [head, ...rows] = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!head) return [];
  const cols = head.map((c) => c.trim().toLowerCase());
  for (const required of ["repo", "file", "line"]) if (!cols.includes(required)) throw new Error(`inventory CSV has no "${required}" column`);
  // Object.fromEntries defines own properties: a `__proto__` header is a plain key, not a prototype
  return rows.map((cells) => Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""])));
}

/** `JSON.parse`, with an error that does not quote the text (its messages show a snippet of the input). */
export function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${what} is not valid JSON`);
  }
}

function jsonRecords(text: string): Record<string, unknown>[] {
  const parsed = parseJson(text, "the inventory");
  const list = Array.isArray(parsed) ? parsed : (parsed as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(list)) throw new Error("inventory JSON is neither an array nor an object with an `entries` array");
  return list.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null && !Array.isArray(r));
}

/** Parses an inventory: JSON when the text starts with `[` or `{`, CSV otherwise. */
export function parseInventory(text: string): Inventory {
  const trimmed = text.replace(/^\uFEFF/, "").trimStart();
  const records = trimmed.startsWith("[") || trimmed.startsWith("{") ? jsonRecords(trimmed) : csvRecords(text);
  if (records.length > MAX_ROWS) throw new Error(`inventory has more than ${MAX_ROWS} rows`);
  const entries = records.map(entryOf);
  return { entries: entries.filter((e): e is InventoryEntry => !!e), rejected: entries.filter((e) => !e).length };
}

export function readInventory(file: string): Inventory {
  return parseInventory(readBounded(file, MAX_INVENTORY_BYTES));
}
