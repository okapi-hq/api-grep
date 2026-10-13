import type { Annotation, Arg, Expr } from "../ir/model.js";
import { springPlaceholders } from "./placeholders.js";

/**
 * What the annotations of a property, a field or a parameter say about its value, the same in Kotlin and Java: the
 * JSON key it is serialized under, whether it is serialized at all, and the configuration value Spring injects.
 */

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

/** Spring `@Value("${api.url:https://x}")`: the configuration value a property or parameter is injected with. */
export function injectedValue(anns: Annotation[]): Expr | undefined {
  const a = anns.find((x) => annotationName(x) === "Value");
  const text = a ? stringArg(a.args, "value") : undefined;
  return text?.includes("${") ? springPlaceholders(text) : undefined;
}
