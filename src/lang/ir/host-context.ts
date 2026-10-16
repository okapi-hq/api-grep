import { calleeRole, keyRole, type LiteralRole } from "../../hosts/context.js";
import type { Language } from "../../report/schema.js";
import { named, type SyntaxNode } from "../tree-sitter.js";

/** The node types each grammar gives the shapes `src/hosts/context.ts` reads around a string literal. */
interface Shapes {
  /** Calls; `echo` and `print` in PHP are statements with no argument list, their whole text the argument. */
  calls: string[];
  /** A call's arguments: what follows the callee. */
  args: string[];
  /** Key and value: the first named child is the key, the last the value (`"url": x`, `url=x`, `URL: x`). */
  pairs: string[];
  /** Literals whose pairs are siblings (a dict, an array, a struct); a pair elsewhere is a named argument. */
  containers: string[];
  /** Nodes between a literal and the key it is the value of (parentheses, a list, a default). */
  through: string[];
  /** Declarations and assignments: a variable's name (`DOCS_URL = "..."`) is a key too. */
  assigns: string[];
  /** Where looking up for a call stops. */
  boundaries: string[];
}

const SHAPES: Partial<Record<Language, Shapes>> = {
  python: {
    calls: ["call"],
    args: ["argument_list"],
    pairs: ["pair", "keyword_argument"],
    containers: ["dictionary"],
    through: ["parenthesized_expression", "list", "tuple", "boolean_operator", "conditional_expression", "concatenated_string"],
    assigns: ["assignment"],
    boundaries: ["function_definition", "lambda", "class_definition", "module", "block"],
  },
  php: {
    calls: ["function_call_expression", "member_call_expression", "nullsafe_member_call_expression", "scoped_call_expression", "object_creation_expression", "echo_statement", "print_intrinsic"],
    args: ["arguments"],
    pairs: ["array_element_initializer"],
    containers: ["array_creation_expression"],
    through: ["argument", "parenthesized_expression", "binary_expression", "conditional_expression", "array_creation_expression"],
    assigns: ["assignment_expression"],
    boundaries: ["function_definition", "method_declaration", "anonymous_function", "arrow_function", "class_declaration", "program", "compound_statement"],
  },
  kotlin: {
    calls: ["call_expression"],
    args: ["value_arguments", "call_suffix"],
    pairs: ["value_argument"],
    containers: [],
    through: ["parenthesized_expression", "collection_literal", "elvis_expression"],
    assigns: [],
    boundaries: ["function_declaration", "lambda_literal", "anonymous_function", "class_declaration", "object_declaration", "source_file", "block"],
  },
  java: {
    calls: ["method_invocation", "object_creation_expression"],
    args: ["argument_list"],
    pairs: ["element_value_pair"],
    containers: [],
    through: ["parenthesized_expression", "element_value_array_initializer", "ternary_expression"],
    assigns: ["variable_declarator"],
    boundaries: ["method_declaration", "constructor_declaration", "lambda_expression", "class_declaration", "program", "block"],
  },
  go: {
    calls: ["call_expression"],
    args: ["argument_list"],
    pairs: ["keyed_element"],
    containers: ["literal_value"],
    through: ["literal_element", "parenthesized_expression", "expression_list", "literal_value"],
    assigns: ["const_spec", "var_spec"],
    boundaries: ["function_declaration", "method_declaration", "func_literal", "source_file", "block"],
  },
  rust: {
    calls: ["macro_invocation", "call_expression"],
    args: ["token_tree", "arguments"],
    pairs: ["field_initializer"],
    containers: ["field_initializer_list"],
    through: ["parenthesized_expression", "reference_expression", "array_expression"],
    assigns: ["let_declaration", "const_item", "static_item"],
    boundaries: ["function_item", "closure_expression", "impl_item", "mod_item", "source_file", "block"],
  },
  // a call is a primary and sibling selectors, with no node of its own: keys and variables only
  dart: {
    calls: [],
    args: [],
    pairs: ["pair"],
    containers: ["set_or_map_literal"],
    through: ["argument", "parenthesized_expression", "list_literal", "if_null_expression", "conditional_expression"],
    assigns: ["initialized_variable_definition"],
    boundaries: ["function_body", "function_expression_body", "class_body", "program", "block"],
  },
};

const MAX_DEPTH = 12;
const same = (a: SyntaxNode, b: SyntaxNode): boolean => a.startIndex === b.startIndex && a.endIndex === b.endIndex && a.type === b.type;
const values = (n: SyntaxNode): SyntaxNode[] => named(n).filter((c) => !c.type.endsWith("comment"));

/** `text` when the literal is (part of) an argument of a logging, printing or navigating call or an error, through formatting calls. */
function callRole(n: SyntaxNode, s: Shapes): LiteralRole | undefined {
  let cur = n;
  for (let p = n.parent, depth = 0; p && depth < MAX_DEPTH && !s.boundaries.includes(p.type); cur = p, p = p.parent, depth++) {
    if (!s.calls.includes(p.type)) continue;
    const args = p.children.find((c): c is SyntaxNode => !!c && s.args.includes(c.type));
    // `echo "..."`: the statement's keyword is its callee
    const callee = args ? p.text.slice(0, args.startIndex - p.startIndex) : (p.child(0)?.text ?? "");
    const role = calleeRole(callee);
    if (role === "text" && (!args || same(cur, args))) return "text";
    if (role !== "format") return undefined;
  }
  return undefined;
}

/** Rust's `"...".to_string()`, `.into()`, `.to_owned()`: the literal itself. */
function converted(n: SyntaxNode): SyntaxNode | undefined {
  const p = n.parent;
  if (p?.type !== "field_expression" || !/^(?:to_string|into|to_owned)$/.test(p.childForFieldName("field")?.text ?? "")) return undefined;
  return p.parent?.type === "call_expression" ? p.parent : undefined;
}

/** The role the key or variable name a literal is the value of gives it; siblings only in a dict, array or struct. */
function keyContext(n: SyntaxNode, s: Shapes): LiteralRole | undefined {
  let cur = n;
  for (let p = cur.parent; p; p = cur.parent) {
    const kv = s.pairs.includes(p.type) ? values(p) : [];
    if (kv.length >= 2) {
      if (!same(kv.at(-1)!, cur)) return undefined;
      const container = p.parent && s.containers.includes(p.parent.type) ? p.parent : undefined;
      const siblings = container && values(container).filter((q) => q.type === p.type && !same(q, p)).map((q) => values(q)[0]?.text ?? "");
      return keyRole(kv[0]!.text, siblings);
    }
    if (s.assigns.includes(p.type)) {
      const name = p.childForFieldName("left") ?? p.childForFieldName("name") ?? p.childForFieldName("pattern");
      const value = p.childForFieldName("right") ?? p.childForFieldName("value");
      return name && value && same(value, cur) && /^\$?\w+$/.test(name.text) ? keyRole(name.text.replace(/^\$/, "")) : undefined;
    }
    // a pair with one value is a list's element (`['https://...']`, a positional argument)
    const next = s.through.includes(p.type) || kv.length === 1 ? p : converted(cur);
    if (!next) return undefined;
    cur = next;
  }
  return undefined;
}

/** What a string literal of a tree-sitter language is, for `coverage.hosts` (`src/hosts/context.ts`). */
export function literalRole(n: SyntaxNode, language: Language): LiteralRole | undefined {
  const s = SHAPES[language];
  return s ? (callRole(n, s) ?? keyContext(n, s)) : undefined;
}
