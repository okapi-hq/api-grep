import { mergeModels } from "../model/fact.js";
import type { Call, UnfollowedCall } from "../report/schema.js";

/**
 * Host tables: a call's base URL picked at run time from a finite table of literals the code writes (an entry of an
 * object, dict or map read with a key known at run time only, `PROVIDERS[name]`; the element a search returns,
 * `LIST.find(p => p.key === id)`, `next(d for d in DEFAULTS if ...)`; one of a helper's several returns; one arm of a
 * Rust `match`). Both evaluators meet these as choice points: without a pick they read as before (no entry, or the
 * first entry with a literal host); with one they read that entry. A call whose URL meets a choice point is built once
 * per entry and reported once per candidate host (`withCandidates`); the other reads of the same point (a model the
 * entry pairs with its URL) read the same entry.
 */

/** Candidates per call: above, the call keeps its first reading and a `host-table-limit` diagnostic says why. */
export const MAX_CANDIDATES = 20;
/** Choice points tried per call, in the order its URL meets them. */
const MAX_POINTS = 3;

export interface ChoicePoint {
  /** The node or expression that picks (an element access, a search call, a helper call, a `match`). */
  key: object;
  size: number;
}

export interface Choice {
  /** The entry read at each choice point, by key; a point without one reads as it did before host tables. */
  picks: ReadonlyMap<object, number>;
  /** Records the choice points met (while resolving a call's URL only). */
  seen?: ChoicePoint[];
}

/** The entry picked at choice point `key` among `entries`; undefined without a pick (the caller reads as before). */
export function choose<T>(choice: Choice | undefined, key: object, entries: readonly T[]): T | undefined {
  if (!choice || entries.length < 2) return undefined;
  if (choice.seen && !choice.seen.some((p) => p.key === key)) choice.seen.push({ key, size: entries.length });
  const i = choice.picks.get(key);
  return i === undefined ? undefined : entries[i];
}

/** Calls whose host table was over `MAX_CANDIDATES`, with its size. Keyed by the report's call objects, never copied. */
const overCap = new WeakMap<Call, number>();

/** Where a candidate goes: its host, else its env var or kind (`relative`). */
const candidateKey = (c: Call): string => c.host ?? (c.envName ? `env:${c.envName}` : c.hostKind);

/** One call per distinct request; copies that differ by model only are one call naming every model. */
function merged(calls: Call[]): Call[] {
  const out = new Map<string, Call>();
  for (const c of calls) {
    const key = JSON.stringify({ ...c, id: undefined, model: undefined });
    const prev = out.get(key);
    if (!prev) out.set(key, c);
    else if (c.model) out.set(key, { ...prev, model: prev.model ? mergeModels(prev.model, c.model) : c.model });
  }
  return [...out.values()];
}

/**
 * The calls one per candidate: the copies whose host is known (an entry without one, or one the scan cannot read, is
 * left out), each with every candidate host in `hostAlternatives`. Undefined when the entries do not tell hosts apart
 * (a table of paths, of models), or tell one host the first reading already had.
 */
function candidates(first: Call[], copies: Call[][]): Call[] | undefined {
  const known = merged(copies.flat().filter((c) => c.hostKind !== "unknown"));
  const keys = new Set(known.map(candidateKey));
  if (keys.size === 0) return undefined;
  if (keys.size === 1) return first.some((c) => c.hostKind !== "unknown") ? undefined : known;
  const hosts = [...new Set(known.flatMap((c) => (c.host ? [c.host] : [])))];
  return known.map((c) => ({ ...c, hostAlternatives: hosts }));
}

/**
 * The calls of a request sent to one of several places the code picks among at run time (the models an AI SDK call
 * may get, `detect/ai-sdk.ts`): built once each, reported as a host table's candidates are.
 */
export function asCandidates(built: Call[][]): Call[] {
  return candidates(built[0] ?? [], built) ?? merged(built.flat());
}

/**
 * Builds a call, then once per entry of the first host table its URL reads (of the first `MAX_POINTS` that tell hosts
 * apart): one call per candidate host, in table order, so each id is the place's with its index (`onePerRequest`).
 */
export function withCandidates(build: (choice: Choice) => Call[]): Call[] {
  const seen: ChoicePoint[] = [];
  const first = build({ picks: new Map(), seen });
  for (const point of seen.slice(0, MAX_POINTS)) {
    const pick = (i: number): Call[] => build({ picks: new Map([[point.key, i]]) });
    if (point.size > MAX_CANDIDATES) {
      // a table too large to list: noted only when its entries are what the host is read from
      if (!pick(0).some((c) => c.hostKind !== "unknown")) continue;
      for (const c of first) overCap.set(c, point.size);
      return first;
    }
    const fanned = candidates(first, Array.from({ length: point.size }, (_, i) => pick(i)));
    if (fanned) return fanned;
  }
  return first;
}

/** One `host-table-limit` entry per location of the calls built from one request whose host table was too large. */
export function tableDiagnostics(calls: Call[]): UnfollowedCall[] {
  const out = new Map<string, UnfollowedCall>();
  for (const c of calls) {
    const size = overCap.get(c);
    const key = `${c.location.file}:${c.location.line}`;
    if (size !== undefined && !out.has(key)) {
      out.set(key, { file: c.location.file, line: c.location.line, reason: "host-table-limit", detail: `${size} candidates (at most ${MAX_CANDIDATES})` });
    }
  }
  return [...out.values()];
}
