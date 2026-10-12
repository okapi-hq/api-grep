import type { BranchSyntax } from "../branches.js";
import type { Arg, Assign, Entry, Expr } from "../ir/model.js";

/**
 * Statements that change the keys of an array variable (`src/lang/ir/edits.ts`): `$params['k'] = $v`,
 * `$params += [...]`, `unset($params['k'])`; and `array_merge(...)` read as a spread.
 */

export const PHP_BRANCHES: BranchSyntax = {
  ifStatement: "if_statement",
  then: "body",
  elseClause: "else_clause",
  // a `do` body always runs once
  loops: new Set(["for_statement", "foreach_statement", "while_statement"]),
  clauses: new Set(["case_statement", "default_statement", "catch_clause"]),
};

const entriesOf = (value: Expr): Entry[] => (value.k === "dict" ? value.entries : [{ value, spread: true }]);

/** `$params['k'] = $v` (`merge`) or `$params += [...]` (`default`: the keys not set yet). */
export function setEdit(target: string, key: Expr | undefined, value: Expr, offset: number): Assign {
  const entries: Entry[] = key ? [{ key, value }] : entriesOf(value);
  return { target, value: { k: "dict", entries }, offset, edit: key ? "merge" : "default" };
}

export function unsetEdit(target: string, key: Expr, offset: number): Assign {
  return { target, value: { k: "list", items: [key] }, offset, edit: "remove" };
}

/** `array_merge($params, ['k' => $v])`: a spread of each array (later keys win), when one of them has keys. */
export function arrayMerge(args: Arg[]): Expr | undefined {
  if (args.length < 2 || args.some((a) => a.spread || a.name)) return undefined;
  if (!args.some((a) => a.value.k === "dict" && a.value.entries.some((e) => e.key))) return undefined;
  return { k: "dict", entries: args.flatMap((a) => entriesOf(a.value)) };
}
