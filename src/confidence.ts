import type { HostKind, Shape } from "./types.js";

export interface Evidence {
  sdkHit: boolean;
  hostKind: HostKind;
  envHinted: boolean;
  pathDynamicNamed: boolean;
  bodySource: "literal" | "type" | "unknown" | "none";
  viaWrapper: boolean;
  specMatched: boolean;
  optionsOpaque: boolean;
}

export function bodySourceOf(shape: Shape | undefined, fromType: string | undefined, bodyFromLiteral: boolean): Evidence["bodySource"] {
  if (!shape) return "none";
  if (shape.type === "dynamic" || shape.type === "unknown") return "unknown";
  if (bodyFromLiteral) return "literal";
  if (fromType || shape.type === "object") return "type";
  return "literal";
}

/** Additive scoring rules from the design; clamped to [0, 1]. */
export function score(e: Evidence): number {
  let s = 0;
  let cap = 1;
  if (e.sdkHit) s += 0.6;
  if (e.hostKind === "literal" || e.hostKind === "const") s += 0.3;
  else if (e.hostKind === "env") s += e.envHinted ? 0.15 : 0.05;
  else if (e.hostKind === "relative") {
    s += 0.1;
    cap = 0.4;
  } else if (!e.sdkHit) cap = 0.4;
  if (e.pathDynamicNamed) s += 0.1;
  if (e.bodySource === "literal") s += 0.2;
  else if (e.bodySource === "type") s += 0.15;
  else if (e.bodySource === "unknown") s -= 0.2;
  if (e.viaWrapper) s -= 0.1;
  if (e.specMatched) s += 0.1;
  if (e.optionsOpaque) s -= 0.1;
  return Math.max(0, Math.min(cap, Math.round(s * 100) / 100));
}
