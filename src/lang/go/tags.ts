import type { SyntaxNode } from "../tree-sitter.js";
import { lowerString } from "./lower-expr.js";

/** A field's `json` struct tag: the name it serializes under, `omitempty`, or `-` (never serialized). */
export interface JsonTag {
  name?: string;
  omitempty: boolean;
  skip: boolean;
}

/** Reads `json:"max_tokens,omitempty"` out of a struct tag (`` `json:"x" yaml:"y"` ``); undefined without one. */
export function jsonTag(tag: SyntaxNode | undefined): JsonTag | undefined {
  if (!tag) return undefined;
  const text = lowerString(tag);
  const value = text.k === "str" ? /(?:^|\s)json:"([^"]*)"/.exec(text.v)?.[1] : undefined;
  if (value === undefined) return undefined;
  const [name, ...options] = value.split(",");
  if (name === "-" && options.length === 0) return { omitempty: false, skip: true };
  return { ...(name ? { name } : {}), omitempty: options.includes("omitempty") || options.includes("omitzero"), skip: false };
}
