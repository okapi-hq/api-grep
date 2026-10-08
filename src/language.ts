import type { Language } from "./report/schema.js";

const BY_EXTENSION: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".php": "php",
};

/** Language of a source file from its extension; the scanner parses anything else it is given as TypeScript. */
export function languageOf(file: string): Language {
  const dot = file.lastIndexOf(".");
  return (dot >= 0 && BY_EXTENSION[file.slice(dot).toLowerCase()]) || "typescript";
}
