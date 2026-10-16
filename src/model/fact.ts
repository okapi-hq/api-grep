import type { Call } from "../report/schema.js";
import type { DynamicPart, Shape, ValueSource } from "../types.js";
import { valueSources } from "./value-sources.js";

/**
 * The model a call names, read the same way for every language from what the front end resolved: an explicit model
 * value (an SDK argument that is not the body), a body property, or a path segment. Facts only: the names the code
 * gives, the environment variable it reads, and whether some branch could not be read.
 */

export type ModelFact = NonNullable<Call["model"]>;
export type ModelSource = NonNullable<ModelFact["sources"]>[number];

/** Body properties that name a model, in every API that has one in its body. */
const BODY_KEYS = ["model", "modelId", "model_id", "modelName", "model_name"];
/** Path segments followed by a model: `/v1beta/models/{model}:generateContent`, Bedrock's `/model/{modelId}/converse`, Azure's deployments. */
const PATH_SEGMENTS = new Set(["models", "model", "deployments", "publishers-models"]);

interface Acc {
  /** Each value and where it comes from; null: a literal of the code, which wins over any source. */
  values: Map<string, ModelSource | null>;
  env?: string;
  dynamic: boolean;
  hint?: string;
}

/** What a model id can look like when the code does not write it as the model: no spaces, `+`, braces or `$`. */
const SOURCED_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;
/** A stand-in a fallback or a config gives (`mock-model`, `fake`, `dummy-llm`), not a model a provider serves. */
const STAND_IN = /^(mock|fake|dummy|stub)([-_.]|$)|[-_](mock|fake|dummy|stub)$/i;

/** The value's source: an env var's literal default is a default; a literal stays one wherever else it is seen. */
function add(acc: Acc, value: string, source: ValueSource | undefined, env: boolean): void {
  const src: ModelSource | null = source ? { value, ...source } : env ? { value, from: "default" } : null;
  // a default or a config value that cannot be a model id is no model the call sends
  if (src && (!SOURCED_NAME.test(value) || STAND_IN.test(value))) {
    acc.dynamic = true;
    return;
  }
  if (!acc.values.has(value) || src === null) acc.values.set(value, src);
}

function collect(s: Shape, acc: Acc, depth = 0): void {
  if (depth > 6) return;
  switch (s.type) {
    case "string":
      for (const v of s.enum ?? []) if (typeof v === "string" && v !== "") add(acc, v, valueSources(s)?.get(v), !!s.env);
      if (s.env) acc.env ??= s.env;
      // a string with no known value, read from neither a literal nor an env var: something the scan could not follow
      if (!s.enum?.length && !s.env) {
        acc.dynamic = true;
        acc.hint ??= s.hint;
      }
      return;
    case "union":
      for (const member of s.anyOf) if (member.type !== "null") collect(member, acc, depth + 1);
      return;
    case "dynamic":
    case "unknown":
      acc.dynamic = true;
      if (s.type === "dynamic") acc.hint ??= s.hint;
      return;
    default:
      // a number, an object: not a model name
      acc.dynamic = true;
  }
}

/** The fact a model value's shape gives; undefined when it says nothing (no value, no env var, nothing dynamic). */
export function modelFromShape(shape: Shape | undefined, from: ModelFact["from"]): ModelFact | undefined {
  if (!shape) return undefined;
  const acc: Acc = { values: new Map(), dynamic: false };
  collect(shape, acc);
  if (acc.values.size === 0 && !acc.env && !acc.dynamic) return undefined;
  const sources = [...acc.values.values()].filter((v): v is ModelSource => v !== null);
  return {
    values: [...acc.values.keys()],
    ...(acc.env ? { env: acc.env } : {}),
    dynamic: acc.dynamic,
    ...(acc.dynamic && acc.hint ? { hint: acc.hint } : {}),
    ...(sources.length > 0 ? { sources } : {}),
    from,
  };
}

function bodyModel(body: Shape | undefined): ModelFact | undefined {
  if (body?.type !== "object") return undefined;
  for (const key of BODY_KEYS) {
    const value = body.properties[key];
    if (value) return modelFromShape(value, "body");
  }
  return undefined;
}

/** A model in the path: a literal segment after `models/` (its `:action` dropped), or the placeholder there. */
function pathModel(pathTemplate: string, dynamic: DynamicPart[]): ModelFact | undefined {
  const segs = pathTemplate.split("/");
  for (let i = 0; i < segs.length - 1; i++) {
    if (!PATH_SEGMENTS.has(segs[i]!.toLowerCase())) continue;
    // `gemini-2.0-flash:generateContent` drops its action; Bedrock's `...-v1:0` keeps its version
    const seg = segs[i + 1]!.replace(/:[A-Za-z]+$/, "");
    if (!seg) continue;
    const placeholder = /^\{([^}]+)\}$/.exec(seg);
    if (!placeholder) return seg.includes("{") ? undefined : { values: [decodeURIComponent(seg)], dynamic: false, from: "path" };
    // a placeholder with no dynamic part holds a literal the registry does not write in: its value is not known here
    const part = dynamic.find((d) => d.where === "path" && d.name === placeholder[1]);
    return part ? modelFromShape(part.shape ?? { type: "dynamic", origin: "unknown", hint: placeholder[1] }, "path") : undefined;
  }
  return undefined;
}

/** The model of a resolved call: the explicit model value first, then the body, then the path. */
export function modelOf(input: { model?: Shape; body?: Shape; pathTemplate: string; dynamic: DynamicPart[] }): ModelFact | undefined {
  return modelFromShape(input.model, "argument") ?? bodyModel(input.body) ?? pathModel(input.pathTemplate, input.dynamic);
}

/** The sources kept for `values` only: a source for a value a literal also gives is dropped, as `collect` does. */
function keptSources(values: string[], sources: ModelSource[], literal: Set<string>): Pick<ModelFact, "sources"> {
  const seen = new Set<string>();
  const kept = sources.filter((s) => values.includes(s.value) && !literal.has(s.value) && !seen.has(s.value) && seen.add(s.value));
  return kept.length > 0 ? { sources: kept } : {};
}

const literalsOf = (m: ModelFact): string[] => m.values.filter((v) => !m.sources?.some((s) => s.value === v));

/** The fact with each value renamed (`anthropic/claude-sonnet-4` to `claude-sonnet-4`), its sources following it. */
export function mapModelValues(model: ModelFact, rename: (v: string) => string): ModelFact {
  const values = [...new Set(model.values.map(rename))];
  const renamed = (model.sources ?? []).map((s) => ({ ...s, value: rename(s.value) }));
  const out: ModelFact = { ...model, values };
  delete out.sources;
  return { ...out, ...keptSources(values, renamed, new Set(literalsOf(model).map(rename))) };
}

/** Two readings of one call's model (copies of a call that differ by model only): every value of either. */
export function mergeModels(a: ModelFact, b: ModelFact): ModelFact {
  const values = [...new Set([...a.values, ...b.values])];
  const literal = new Set([...literalsOf(a), ...literalsOf(b)]);
  const merged: ModelFact = { ...a, values, dynamic: a.dynamic || b.dynamic };
  delete merged.sources;
  return { ...merged, ...keptSources(values, [...(a.sources ?? []), ...(b.sources ?? [])], literal) };
}
