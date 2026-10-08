import type { Language } from "../report/schema.js";
import { php } from "./php/index.js";
import { python } from "./python/index.js";
import type { LanguageFrontEnd } from "./types.js";
import { typescript } from "./typescript/index.js";

/** Every front end the scanner runs, in report order. */
export const LANGUAGES: LanguageFrontEnd[] = [typescript, python, php];

export const LANGUAGE_IDS = LANGUAGES.flatMap((l) => l.ids);

/** The front ends to run and their languages: all of them, or the ones asked for (`--language python,html`). */
export function selectLanguages(ids: Language[] | undefined): { frontEnd: LanguageFrontEnd; languages: Language[] }[] {
  const unknown = (ids ?? []).filter((id) => !LANGUAGE_IDS.includes(id));
  if (unknown.length > 0) throw new Error(`unknown language: ${unknown.join(", ")} (supported: ${LANGUAGE_IDS.join(", ")})`);
  return LANGUAGES.map((frontEnd) => ({ frontEnd, languages: ids && ids.length > 0 ? frontEnd.ids.filter((id) => ids.includes(id)) : frontEnd.ids })).filter(
    (s) => s.languages.length > 0,
  );
}
