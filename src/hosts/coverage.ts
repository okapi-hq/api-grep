import type { Call, HostCoverage, Language } from "../report/schema.js";
import { normalizeHost, type HostLiterals } from "./literals.js";

/** Unexplained hosts listed in a report; `named` and `explained` still count them all. */
export const MAX_UNEXPLAINED = 200;

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The hosts the calls name: concrete ones, and templates (`{project}.supabase.co`) as patterns where each placeholder
 * stands for one label or more. A template with no literal domain (`{baseUrl}`) names nothing.
 */
function callHosts(calls: Call[]): { exact: Set<string>; patterns: RegExp[] } {
  const exact = new Set<string>();
  const templates = new Set<string>();
  for (const c of calls) {
    if (!c.host) continue;
    const lower = c.host.toLowerCase().replace(/:[^:{}]*$/, "");
    if (!lower.includes("{")) {
      const host = normalizeHost(lower);
      if (host) exact.add(host);
    } else if (/\.[a-z0-9-]+\.[a-z]{2,}$/.test(lower.slice(lower.lastIndexOf("}") + 1))) templates.add(lower);
  }
  const patterns = [...templates].map((t) => new RegExp(`^${t.split(/\{[^}]*\}/).map(escape).join("[a-z0-9-]+(?:\\.[a-z0-9-]+)*")}$`));
  return { exact, patterns };
}

type ByLanguage = NonNullable<HostCoverage["byLanguage"]>;

/** Counts a host under its language (the first file naming it), most named first, then by language. */
function tally(counts: Map<Language, ByLanguage[number]>, language: Language, explained: boolean): void {
  const c = counts.get(language) ?? { language, named: 0, explained: 0 };
  c.named++;
  if (explained) c.explained++;
  counts.set(language, c);
}

const sorted = (counts: Map<Language, ByLanguage[number]>): ByLanguage =>
  [...counts.values()].sort((a, b) => b.named - a.named || (a.language < b.language ? -1 : 1));

/**
 * `coverage.hosts`: the API-looking hosts the scanned files name, how many a call explains (its host, case and port
 * aside), the same per language, and the others, most widespread first.
 */
export function hostCoverage(literals: HostLiterals, calls: Call[]): HostCoverage {
  const { exact, patterns } = callHosts(calls);
  const explains = (host: string): boolean => exact.has(host) || patterns.some((p) => p.test(host));
  let explained = 0;
  const unexplained: HostCoverage["unexplained"] = [];
  const counts = new Map<Language, ByLanguage[number]>();
  for (const [host, s] of literals.seen) {
    const isExplained = explains(host);
    tally(counts, s.language, isExplained);
    if (isExplained) explained++;
    else unexplained.push({ host, files: s.files.size, literals: s.literals, language: s.language, first: s.first });
  }
  unexplained.sort((a, b) => b.files - a.files || (a.host < b.host ? -1 : a.host > b.host ? 1 : 0));
  return { named: literals.seen.size, explained, byLanguage: sorted(counts), unexplained: unexplained.slice(0, MAX_UNEXPLAINED) };
}
