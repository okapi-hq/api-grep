import type { Language } from "../report/schema.js";
import { php } from "./php/index.js";
import { python } from "./python/index.js";
import type { LanguageFrontEnd } from "./types.js";
import { typescript } from "./typescript/index.js";

/** Every language the scanner reads, in report order. */
export const LANGUAGES: LanguageFrontEnd[] = [typescript, python, php];

export const LANGUAGE_IDS = LANGUAGES.map((l) => l.id);

/** The languages to scan: all of them, or the ones asked for (`--language python,php`). */
export function selectLanguages(ids: Language[] | undefined): LanguageFrontEnd[] {
  if (!ids || ids.length === 0) return LANGUAGES;
  const unknown = ids.filter((id) => !LANGUAGE_IDS.includes(id));
  if (unknown.length > 0) throw new Error(`unknown language: ${unknown.join(", ")} (supported: ${LANGUAGE_IDS.join(", ")})`);
  return LANGUAGES.filter((l) => ids.includes(l.id));
}
