import { addBranch } from "./ir/edits.js";
import type { FunctionDef } from "./ir/model.js";
import { field, type SyntaxNode } from "./tree-sitter.js";

/** Node names of a grammar's conditional blocks. */
export interface BranchSyntax {
  /** The `if` statement, with its block in field `then` and its `elif` / `else` clauses in field `alternative`. */
  ifStatement: string;
  then: string;
  elseClause: string;
  /** Statements whose `body` may run zero times. */
  loops: Set<string>;
  /** Clauses that may not run (`except`, `case`), outside an `if`. */
  clauses: Set<string>;
}

/**
 * Registers the blocks of a statement or clause that may not run, for keys a dict gets there (`ir/edits.ts`). An `if`
 * that ends with an `else` runs exactly one of its blocks: they form a group.
 */
export function markBranches(n: SyntaxNode, fn: FunctionDef, syntax: BranchSyntax): void {
  if (n.type === syntax.ifStatement) {
    const alternatives = n.childrenForFieldName("alternative").filter((c): c is SyntaxNode => !!c);
    const blocks = [field(n, syntax.then), ...alternatives].filter((c): c is SyntaxNode => !!c);
    const group = alternatives.at(-1)?.type === syntax.elseClause ? { id: n.startIndex, size: blocks.length } : undefined;
    for (const b of blocks) addBranch(fn, b.startIndex, b.endIndex, group);
  } else if (syntax.loops.has(n.type)) {
    const body = field(n, "body");
    if (body) addBranch(fn, body.startIndex, body.endIndex);
  } else if (syntax.clauses.has(n.type) && n.parent?.type !== syntax.ifStatement) {
    addBranch(fn, n.startIndex, n.endIndex);
  }
}
