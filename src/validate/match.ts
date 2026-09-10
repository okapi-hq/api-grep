import { isPlaceholder, looksLikeId, segments } from "../normalize/path.js";
import type { LoadedSpec, SpecOperation } from "./spec-loader.js";

function scoreMatch(candidate: string[], actual: string[]): number {
  if (candidate.length !== actual.length) return -1;
  let s = 0;
  for (let i = 0; i < candidate.length; i++) {
    const c = candidate[i]!;
    const a = actual[i]!;
    if (c === a) s += 3;
    else if (isPlaceholder(c) && isPlaceholder(a)) s += 2;
    else if (isPlaceholder(c) && looksLikeId(a)) s += 1;
    else if (isPlaceholder(c)) s += 0;
    else return -1;
  }
  return s;
}

/** Finds the spec operation for a method + path template; static segments must match, placeholders are wildcards. */
export function matchOperation(spec: LoadedSpec, method: string, pathTemplate: string): SpecOperation | undefined {
  let best: { op: SpecOperation; score: number } | undefined;
  for (const base of spec.basePaths) {
    if (base && !pathTemplate.startsWith(`${base}/`) && pathTemplate !== base) continue;
    const rel = base ? pathTemplate.slice(base.length) || "/" : pathTemplate;
    const actual = segments(rel);
    for (const [pathKey, ops] of spec.paths) {
      const op = ops[method];
      if (!op) continue;
      const s = scoreMatch(segments(pathKey), actual);
      if (s >= 0 && (!best || s > best.score)) best = { op, score: s };
    }
  }
  return best?.op;
}
