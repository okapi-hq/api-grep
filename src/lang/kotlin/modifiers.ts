import type { Annotation } from "../ir/model.js";
import { named, type SyntaxNode } from "../tree-sitter.js";
import { lowerArgs } from "./lower-expr.js";
import { posOf, type KtState } from "./state.js";
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
