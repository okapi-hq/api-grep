import type { Language } from "../report/schema.js";
import { isApiHost, isBareApiHost } from "./api-host.js";

/** A host a string literal names, and where. */
export interface HostMention {
  host: string;
  /** Lines into the literal (a URL on the third line of a template string: 2). */
  lineOffset: number;
}

/** Only so much of one literal is read (a prompt or an embedded document), and only so many hosts kept per scan. */
const MAX_LITERAL_CHARS = 64 * 1024;
export const MAX_MENTIONS = 50_000;
/** Generated sources (bundles, vendored data) past this size are not read for hosts. */
export const MAX_SOURCE_CHARS = 2 * 1024 * 1024;

/** `https://user@host:port/path`: the host and what follows it, up to a quote, a space or a markup character. */
const URL_RE = /\bhttps?:\/\/(?:[^\s/?#@"'`<>\\]*@)?([^\s/?#"'`<>\\]+)([^\s"'`<>\\]*)/gi;
/** A literal that is a host and nothing else (`api.acme.com`, `api.acme.com/v1`). */
const BARE_RE = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d{1,5})?(\/[^\s]*)?$/i;

/** `API.Acme.com.:443` -> `api.acme.com`; undefined when what remains is not a plain host (a placeholder, `%s`). */
export function normalizeHost(raw: string): string | undefined {
  const host = raw
    .toLowerCase()
    .replace(/:\d{1,5}$/, "")
    .replace(/\.$/, "");
  return /^[a-z0-9.-]+$/.test(host) ? host : undefined;
}

const linesBefore = (text: string, index: number): number => {
  let n = 0;
  for (let i = text.indexOf("\n"); i >= 0 && i < index; i = text.indexOf("\n", i + 1)) n++;
  return n;
};

/** The API-looking hosts a string literal's text names: every `http(s)://` URL in it, or the literal itself when it is a host. */
export function hostsInLiteral(literal: string): HostMention[] {
  const text = literal.length > MAX_LITERAL_CHARS ? literal.slice(0, MAX_LITERAL_CHARS) : literal;
  if (!text.includes(".")) return [];
  const out: HostMention[] = [];
  if (text.includes("://")) {
    for (const m of text.matchAll(URL_RE)) {
      const host = normalizeHost(m[1]!);
      if (host && isApiHost(host, m[2]!)) out.push({ host, lineOffset: linesBefore(text, m.index) });
    }
    return out;
  }
  const bare = text.length <= 256 ? BARE_RE.exec(text.trim()) : null;
  const host = bare ? normalizeHost(bare[1]!) : undefined;
  return host && isBareApiHost(host, bare![2] ?? "") ? [{ host, lineOffset: 0 }] : [];
}

/** Where an API-looking host is named: files, literals, and the first occurrence (by file, then line). */
export interface HostSeen {
  files: Set<string>;
  literals: number;
  first: { file: string; line: number };
  language: Language;
}

/**
 * The API-looking hosts named in the string literals of the scanned files. Each front end hands it its literals; the
 * report compares them with the calls' hosts (`coverage.hosts`).
 */
export class HostLiterals {
  readonly seen = new Map<string, HostSeen>();
  private mentions = 0;

  /** A string literal of a scanned file (`file` relative to the scanned directory) starting at `line` (1-based). */
  add(text: string, file: string, line: number, language: Language): void {
    if (this.mentions >= MAX_MENTIONS) return;
    for (const m of hostsInLiteral(text)) {
      this.mentions++;
      const at = { file, line: line + m.lineOffset };
      const s = this.seen.get(m.host);
      if (!s) {
        this.seen.set(m.host, { files: new Set([file]), literals: 1, first: at, language });
        continue;
      }
      s.files.add(file);
      s.literals++;
      const order = file.localeCompare(s.first.file) || at.line - s.first.line;
      if (order < 0) Object.assign(s, { first: at, language });
    }
  }
}
