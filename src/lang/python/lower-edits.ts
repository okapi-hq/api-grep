import type { BranchSyntax } from "../branches.js";
import type { Arg, Assign, Entry, Expr } from "../ir/model.js";

/**
 * Statements that change the keys of a dict variable (`src/lang/ir/edits.ts`): `kwargs["k"] = v`, `kwargs |= {...}`,
 * `kwargs.update(...)`, `kwargs.setdefault("k", v)`, `kwargs.pop("k")`, `del kwargs["k"]`.
 */

export const PY_BRANCHES: BranchSyntax = {
  ifStatement: "if_statement",
  then: "consequence",
  elseClause: "else_clause",
  loops: new Set(["for_statement", "while_statement"]),
  clauses: new Set(["else_clause", "except_clause", "except_group_clause", "case_clause"]),
};

/** The entries a value adds to a dict: a literal's own, anything else spread. */
function entriesOf(value: Expr): Entry[] {
  return value.k === "dict" ? value.entries : [{ value, spread: true }];
}

/** `kwargs |= {...}`, `kwargs["k"] = v` (a dict of one entry). */
export function mergeEdit(target: string, value: Expr, offset: number): Assign {
  return { target, value: { k: "dict", entries: entriesOf(value) }, offset, edit: "merge" };
}

export function removeEdit(target: string, key: Expr, offset: number): Assign {
  return { target, value: { k: "list", items: [key] }, offset, edit: "remove" };
}

/** `update(k=v, **other)`, `update({"k": v})`, `update(other)`: the entries each argument adds. */
function updateEntries(args: Arg[]): Entry[] {
  return args.flatMap((a): Entry[] => {
    if (a.spread === "dict") return [{ value: a.value, spread: true }];
    if (a.name) return [{ key: { k: "str", v: a.name }, value: a.value }];
    return a.spread ? [] : entriesOf(a.value);
  });
}

/** `kwargs.update(...)`, `kwargs.setdefault("k", v)`, `kwargs.pop("k")` on a variable: the edit, else undefined. */
export function callEdit(fn: Expr, args: Arg[], offset: number): Assign | undefined {
  if (fn.k !== "attr" || fn.obj.k !== "name") return undefined;
  const target = fn.obj.name;
  const key = args[0] && !args[0].name && !args[0].spread ? args[0].value : undefined;
  if (fn.name === "update" && args.length > 0) return { target, value: { k: "dict", entries: updateEntries(args) }, offset, edit: "merge" };
  if (fn.name === "setdefault" && key) {
    const value = args[1] && !args[1].name ? args[1].value : ({ k: "null" } as Expr);
    return { target, value: { k: "dict", entries: [{ key, value }] }, offset, edit: "default" };
  }
  if (fn.name === "pop" && key) return removeEdit(target, key, offset);
  return undefined;
}
