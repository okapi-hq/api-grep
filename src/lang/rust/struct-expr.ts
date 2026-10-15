import type { Arg, Expr } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { posOf, type RustState } from "./names.js";
import { pathExpr, segmentsOf } from "./paths.js";

/**
 * `Client { base_url: u, http }`: a struct literal is a call of its type with its fields as named arguments, as Go's
 * composite literals are, so a client built this way is an instance for call chains and the language's `resolveCall`
 * reads a request struct as the dict it serializes to. A literal of a project type gives its class's fields their
 * values (`linkRust`); `..base` adds nothing.
 */

type Lower = (n: SyntaxNode, st: RustState) => Expr;

/** The type a struct expression names, as an expression of the file. */
export function structType(n: SyntaxNode | undefined, st: RustState): Expr | undefined {
  if (!n) return undefined;
  if (n.text === "Self") return st.selfType ?? { k: "name", name: "Self", pos: posOf(n) };
  const segs = segmentsOf(n.type === "generic_type_with_turbofish" ? field(n, "type") : n);
  return segs && segs.length > 0 ? pathExpr(segs, n, st) : undefined;
}

function fieldsOf(body: SyntaxNode | undefined, st: RustState, lower: Lower): Arg[] {
  const out: Arg[] = [];
  for (const f of body ? named(body) : []) {
    if (f.type === "field_initializer") {
      const name = field(f, "field");
      const value = field(f, "value");
      if (name && value) out.push({ name: name.text, value: lower(value, st) });
    } else if (f.type === "shorthand_field_initializer") {
      const id = named(f)[0];
      if (id) out.push({ name: id.text, value: { k: "name", name: id.text, pos: posOf(id) } });
    } else if (f.type === "base_field_initializer") {
      const base = named(f)[0];
      if (base) lower(base, st);
    }
  }
  return out;
}

export function lowerStructExpr(n: SyntaxNode, st: RustState, lower: Lower): Expr {
  const type = structType(field(n, "name"), st);
  const args = fieldsOf(field(n, "body"), st, lower);
  if (!type) return { k: "dict", entries: args.map((a) => ({ key: { k: "str", v: a.name! }, value: a.value })) };
  st.extras.literals.push({ type, fields: args.map((a) => ({ name: a.name!, value: a.value })), fn: st.fn });
  return { k: "call", fn: type, args, pos: posOf(n), isNew: true };
}
