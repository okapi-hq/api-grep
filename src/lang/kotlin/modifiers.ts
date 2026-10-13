import type { Annotation, Arg, Expr } from "../ir/model.js";
import { named, type SyntaxNode } from "../tree-sitter.js";
import { lowerArgs } from "./lower-expr.js";
import { posOf, type KtState } from "./state.js";
import { springPlaceholders } from "../jvm/placeholders.js";
import { lowerType } from "./types.js";

/** Keywords (`private`, `const`, `data`, `override`, `vararg`) and annotations of a declaration. */
export interface Modifiers {
  keywords: Set<string>;
  annotations: Annotation[];
}

/** `@GET("users/{id}")`, `@field:SerializedName("id")` (the use-site target aside), `@Inject`. */
function lowerAnnotation(n: SyntaxNode, st: KtState): Annotation | undefined {
  const inv = named(n).find((c) => c.type === "constructor_invocation");
  const type = lowerType((inv ? named(inv) : named(n)).find((c) => c.type === "user_type")).type;
  if (!type) return undefined;
  return { type, args: inv ? lowerArgs(named(inv).find((c) => c.type === "value_arguments"), st) : [], pos: posOf(n) };
}

/** A `modifiers` or `parameter_modifiers` node. */
export function modifiersOf(n: SyntaxNode | undefined, st: KtState): Modifiers {
  const out: Modifiers = { keywords: new Set(), annotations: [] };
  for (const c of n ? named(n) : []) {
    if (c.type === "annotation") {
      const a = lowerAnnotation(c, st);
      if (a) out.annotations.push(a);
    } else if (c.type.endsWith("_modifier")) out.keywords.add(c.text);
  }
  return out;
}

/** The simple name of an annotation's class: `SerializedName` for `@com.google.gson.annotations.SerializedName`. */
export function annotationName(a: Annotation): string | undefined {
  const t = a.type;
  return t.k === "name" ? t.name : t.k === "attr" ? t.name : t.k === "qname" ? t.path[t.path.length - 1] : undefined;
}

const stringArg = (args: Arg[], name: string): string | undefined => {
  const a = args.find((x) => x.name === name) ?? args.find((x) => !x.name);
  return a?.value.k === "str" ? a.value.v : undefined;
};

/** Gson `@SerializedName`, kotlinx `@SerialName`, Jackson `@JsonProperty`: `value`; Moshi `@Json(name = ...)`: `name`. */
const SERIAL_NAMES: Record<string, string> = { SerializedName: "value", SerialName: "value", JsonProperty: "value", Json: "name" };

/** The JSON key a property is written under, when an annotation renames it. */
export function serialName(anns: Annotation[]): string | undefined {
  for (const a of anns) {
    const arg = SERIAL_NAMES[annotationName(a) ?? ""];
    const v = arg ? stringArg(a.args, arg) : undefined;
    if (v) return v;
  }
  return undefined;
}

const TRANSIENT = new Set(["Transient", "JsonIgnore"]);

/** Left out of the serialized object (`@Transient`, `@JsonIgnore`). */
export const isTransient = (anns: Annotation[]): boolean => anns.some((a) => TRANSIENT.has(annotationName(a) ?? ""));

/** Spring `@Value("\${api.url:https://x}")`: the configuration value a property or parameter is injected with. */
export function injectedValue(anns: Annotation[]): Expr | undefined {
  const a = anns.find((x) => annotationName(x) === "Value");
  const text = a ? stringArg(a.args, "value") : undefined;
  return text?.includes("${") ? springPlaceholders(text) : undefined;
}
