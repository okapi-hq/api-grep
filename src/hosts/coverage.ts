import type { Call, HostCoverage } from "../report/schema.js";
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

/**
 * `coverage.hosts`: the API-looking hosts the scanned files name, how many a call explains (its host, case and port
 * aside), and the others, most widespread first.
 */
export function hostCoverage(literals: HostLiterals, calls: Call[]): HostCoverage {
  const { exact, patterns } = callHosts(calls);
  const explains = (host: string): boolean => exact.has(host) || patterns.some((p) => p.test(host));
  let explained = 0;
  const unexplained: HostCoverage["unexplained"] = [];
  for (const [host, s] of literals.seen) {
    if (explains(host)) explained++;
    else unexplained.push({ host, files: s.files.size, literals: s.literals, language: s.language, first: s.first });
  }
  unexplained.sort((a, b) => b.files - a.files || (a.host < b.host ? -1 : a.host > b.host ? 1 : 0));
  return { named: literals.seen.size, explained, unexplained: unexplained.slice(0, MAX_UNEXPLAINED) };
}
