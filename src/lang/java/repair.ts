/**
 * tree-sitter-java does not parse an annotation on a variable-arity parameter's type (`String @Nullable ... ids`,
 * JSpecify style): the annotation is blanked out with spaces, so every position in the file stays the same.
 */
export function varargsAnnotations(text: string): string {
  return text.replace(/@[\w.]{1,200}(?:\s*\([^()]{0,200}\))?(?=\s*\.\.\.)/g, (m) => m.replace(/[^\r\n]/g, " "));
}
