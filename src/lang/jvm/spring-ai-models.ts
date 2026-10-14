import { valueChain } from "../ir/chain.js";
import { sdkConstant } from "../ir/builders.js";
import type { ConfiguredClient, IrRegistryEntry, Scoped } from "../ir/language.js";
import { dottedPath, type Expr, type FunctionDef } from "../ir/model.js";
import type { IrCtx } from "../ir/raw.js";
import table from "./registry/spring-ai-models.json" with { type: "json" };

/**
 * Spring AI's model enums (`MistralAiApi.ChatModel.MISTRAL_SMALL.getValue()`) and its starters' default models, read
 * with the Spring AI release the build declares (#96). A value that changed between releases needs that release; a
 * default needs a release of the table, else the model stays unknown.
 */

type Versioned = string | Record<string, string>;

const ENUMS = table.enums as Record<string, Record<string, Versioned>>;
const DEFAULTS = table.defaults as Record<string, Versioned>;
const RELEASES = new Set(table.releases);
const ACCESSORS = new Set(["getValue", "getName", "id", "getId", "value"]);
const BOM = "org.springframework.ai:spring-ai-bom";

/** `1.0.10` after `1.0.9`: numeric parts, compared in order. */
function before(a: string, b: string): boolean {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}

/** The value at a release: the last change at or before it; without a release, only a value that never changed. */
function at(v: Versioned, release: string | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (!release || !RELEASES.has(release)) return undefined;
  let out: string | undefined;
  for (const [from, value] of Object.entries(v)) if (!before(release, from)) out = value;
  return out;
}

/** The Spring AI release of the build: the artifact's version, else the BOM's. */
export function springAiRelease(entry: IrRegistryEntry, fn: FunctionDef, ctx: IrCtx): string | undefined {
  const m = ctx.idx.lang.manifests;
  if (!ctx.rootDir) return undefined;
  const file = fn.module.file;
  return m.version(file, entry.package, ctx.rootDir) ?? m.bom?.(file, BOM, ctx.rootDir);
}

/** `X.CONST` (Kotlin `.value` too) or `X.CONST.getValue()`: the constant's expression, without the accessor. */
function constantOf(e: Expr): Expr | undefined {
  if (e.k === "call" && e.args.length === 0 && e.fn.k === "attr" && ACCESSORS.has(e.fn.name)) return e.fn.obj;
  if (e.k === "call" && e.args.length === 0 && e.fn.k === "attr" && e.fn.name === "asString") return e.fn.obj;
  if (e.k === "attr" && e.name === "value") return e.obj;
  return e.k === "attr" || e.k === "name" ? e : undefined;
}

/** The model id a Spring AI enum constant (or an openai-java / anthropic-java one) stands for; undefined otherwise. */
export function enumModel(s: Scoped, release: string | undefined, ctx: IrCtx): Scoped | undefined {
  const e = s.expr.k === "scoped" ? s.expr.expr : s.expr;
  const fn = s.expr.k === "scoped" ? s.expr.fn : s.fn;
  const c = constantOf(e);
  if (!c || (c.k !== "attr" && c.k !== "name") || !/^[A-Z][A-Z0-9_]*$/.test(c.name)) return undefined;
  const names = constantPath(c, fn, ctx);
  const values = names ? ENUMS[names.slice(0, -1).join(".")] : undefined;
  const v = values && Object.hasOwn(values, c.name) ? at(values[c.name]!, release) : undefined;
  if (v !== undefined) return { expr: { k: "str", v }, fn };
  const sdk = sdkConstant(c, fn, ctx);
  return sdk ? { expr: sdk, fn } : undefined;
}

/** The dotted path of a constant: through its import, or written fully qualified. */
function constantPath(c: Expr, fn: FunctionDef, ctx: IrCtx): string[] | undefined {
  const chain = valueChain(c, fn, ctx);
  if (chain.root.kind === "external" && chain.segs.length >= 2 && chain.segs.every((x) => !x.call && !x.typed)) return chain.segs.map((x) => x.name);
  const path = chain.root.kind === "global" || chain.root.kind === "unknown" ? dottedPath(c) : undefined;
  return path && path.length > 2 && /^[a-z]/.test(path[0]!) ? path : undefined;
}

/**
 * The model a starter sends when neither the code nor the configuration sets one, as a read of the model property
 * with the library's default (2.0 names it `<prefix>.model`, 1.x `<prefix>.options.model`).
 */
export function defaultModel(conf: ConfiguredClient, release: string | undefined, fn: FunctionDef): Scoped | undefined {
  const v = Object.hasOwn(DEFAULTS, `${conf.id}.${conf.kind}`) ? DEFAULTS[`${conf.id}.${conf.kind}`] : undefined;
  const value = v !== undefined && release && RELEASES.has(release) ? at(v, release) : undefined;
  if (value === undefined) return undefined;
  const key = (release!.startsWith("1.") ? conf.model[0] : conf.model[1]) ?? conf.model[0]!;
  return { expr: { k: "env", name: key, fallback: { k: "str", v: value } }, fn };
}
