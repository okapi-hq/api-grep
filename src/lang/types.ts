import type { DiagnosticsCollector } from "../report/diagnostics.js";
import type { Call, Ecosystem, Language, SdkCoverage } from "../report/schema.js";
import type { ScanOptions } from "../scan.js";

export interface LanguageScanInput {
  rootDir: string;
  opts: ScanOptions;
  diag: DiagnosticsCollector;
  /** Files changed since `--changed-since` (absolute paths); undefined for a full scan. */
  changed?: Set<string>;
}

export interface LanguageScanResult {
  calls: Call[];
  /** Files in scope, including the ones `--exclude` / `--include` left out. */
  filesSeen: number;
  filesScanned: number;
  /** SDK coverage rows of the language's ecosystem; empty for `--changed-since` scans. */
  coverage: SdkCoverage[];
}

/**
 * A language front end: finds its files, detects and resolves their calls into report `Call`s. Everything after
 * that (specs, examples, redaction, stats, diagnostics, coverage) is shared.
 */
export interface LanguageFrontEnd {
  id: Language;
  ecosystem: Ecosystem;
  extensions: string[];
  /** Resolves to undefined when no file of the language is in scope. */
  scan(input: LanguageScanInput): Promise<LanguageScanResult | undefined>;
}
