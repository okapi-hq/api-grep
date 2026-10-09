import type { DiagnosticsCollector } from "../report/diagnostics.js";
import type { Call, Ecosystem, Language, SdkCoverage } from "../report/schema.js";
import type { ScanOptions } from "../scan.js";

export interface LanguageScanInput {
  rootDir: string;
  opts: ScanOptions;
  diag: DiagnosticsCollector;
  /** Files changed since `--changed-since` (absolute paths); undefined for a full scan. */
  changed?: Set<string>;
  /** The languages of this front end to scan (`--language`), all of them by default. */
  languages: Language[];
}

export interface FileCounts {
  /** Files in scope, including the ones `--exclude` / `--include` left out. */
  filesSeen: number;
  filesScanned: number;
}

export interface LanguageScanResult {
  calls: Call[];
  /** Files per language, for the languages with files in scope. */
  files: Partial<Record<Language, FileCounts>>;
  /** SDK coverage rows of the front end's ecosystem; empty for `--changed-since` scans. */
  coverage: SdkCoverage[];
}

/**
 * A language front end: finds its files, detects and resolves their calls into report `Call`s. Everything after
 * that (specs, examples, redaction, stats, diagnostics, coverage) is shared. One front end can read several
 * languages: the TypeScript checker reads TypeScript, JavaScript and the scripts of HTML files.
 */
export interface LanguageFrontEnd {
  ids: Language[];
  ecosystem: Ecosystem;
  /** Resolves to undefined when no file of its languages is in scope. */
  scan(input: LanguageScanInput): Promise<LanguageScanResult | undefined>;
}
