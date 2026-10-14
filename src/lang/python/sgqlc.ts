import { calleeChain } from "../ir/chain.js";
import type { Scoped } from "../ir/language.js";
import { argFor, dottedPath, type CallExpr, type Expr, type FunctionDef } from "../ir/model.js";
import { lookup } from "../ir/project.js";
import type { IrCtx } from "../ir/raw.js";
import { isSafeKey } from "../../record-keys.js";

/**
 * sgqlc's documents built as objects (#67): `op = Operation(schema.Query, name="Issues")`, then selections made by
 * calling and reading its members (`issues = op.repository(owner=o).issues(first=10)`, `issues.nodes.title()`,
 * `issues.nodes.__fields__("number", "url")`) in the function that builds it. The text it sends is that document,
 * Python names written as sgqlc writes them in GraphQL (`created_at` -> `createdAt`). A project function given the
 * operation or one of its selections (`fetch_issues(op, issues)`, #83) makes its selections under it, three helpers
 * deep; selections made elsewhere are not read: the field they hang under is then a leaf.
 */

const OPERATION = "sgqlc.operation.Operation";
const NAME = /^[_A-Za-z][_0-9A-Za-z]*$/;
/** Field paths read, and their depth: bounds on hostile input (the parser bounds the text again). */
const MAX_PATHS = 2_000;
const MAX_DEPTH = 32;
/** Helpers followed below the function that builds the operation. */
const MAX_HELPERS = 3;

/** `created_at` -> `createdAt`, as sgqlc's `BaseItem._to_graphql_name`. */
function graphqlName(name: string): string {
  const [first, ...rest] = name.split("_");
  return first + rest.map((p) => p.slice(0, 1).toUpperCase() + p.slice(1)).join("");
}

function operationType(call: CallExpr): string | undefined {
  const typ = call.args.find((a) => a.name === "typ") ?? call.args.find((a) => !a.name);
  const last = typ && dottedPath(typ.value)?.at(-1)?.toLowerCase();
  return last && ["mutation", "subscription", "query"].find((t) => last.includes(t));
}

interface Op {
  name: string;
  fn: FunctionDef;
  call: CallExpr;
}

/** The `Operation(...)` construction a name holds in its function. */
function operationOf(e: Expr, fn: FunctionDef, ctx: IrCtx): Op | undefined {
  if (e.k === "scoped") return operationOf(e.expr, e.fn, ctx);
  if (e.k !== "name") return undefined;
  const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
  if (b.kind !== "value" || b.assign.value.k !== "call") return undefined;
  const chain = calleeChain(b.assign.value, b.fn, ctx);
  const path = chain.segs.map((s) => s.name).join(".");
  return chain.root.kind === "external" && path === OPERATION ? { name: e.name, fn: b.fn, call: b.assign.value } : undefined;
}

/** A function making selections: the names in it that stand for a selection (the operation, a helper's parameter). */
interface Scope {
  fn: FunctionDef;
  roots: Map<string, string[]>;
}

/** The selection path from the operation an expression stands for (`op.repository(...).issues` -> repository.issues). */
function selection(e: Expr, scope: Scope, ctx: IrCtx, depth: number): string[] | undefined {
  if (depth > MAX_DEPTH) return undefined;
  if (e.k === "call") return selection(e.fn, scope, ctx, depth + 1);
  if (e.k === "attr") {
    const head = selection(e.obj, scope, ctx, depth + 1);
    // `__as__`, `__to_graphql__`: sgqlc's own members, not fields
    return head && (e.name.startsWith("__") ? head : [...head, e.name]);
  }
  if (e.k !== "name") return undefined;
  const root = scope.roots.get(e.name);
  if (root) return root;
  const b = lookup(e.name, scope.fn, e.pos.offset, ctx.idx);
  return b.kind === "value" && b.fn === scope.fn ? selection(b.assign.value, scope, ctx, depth + 1) : undefined;
}

/** `fetch_issues(op, issues)`: the project function a call runs, with its parameters that get a selection. */
function helperScope(call: CallExpr, scope: Scope, ctx: IrCtx): Scope | undefined {
  const given = call.args.map((a) => selection(a.value, scope, ctx, 0));
  if (given.every((s) => !s)) return undefined;
  const chain = calleeChain(call, scope.fn, ctx);
  if (chain.root.kind !== "function" || chain.segs.length > 0) return undefined;
  const fn = chain.root.fn;
  const roots = new Map<string, string[]>();
  for (const p of fn.params) {
    const arg = argFor(call, p);
    const sel = arg ? given[call.args.indexOf(arg)] : undefined;
    if (sel) roots.set(p.name, sel);
  }
  return roots.size > 0 ? { fn, roots } : undefined;
}

/** Field paths the function selects on the operation, `__fields__("a", "b")` giving one per name, and its helpers'. */
function selectedPaths(scope: Scope, ctx: IrCtx, out: string[][], seen: Set<FunctionDef>): void {
  seen.add(scope.fn);
  for (const call of scope.fn.calls) {
    if (out.length >= MAX_PATHS) break;
    const fields = call.fn.k === "attr" && call.fn.name === "__fields__" ? call.fn.obj : undefined;
    const path = selection(fields ?? call.fn, scope, ctx, 0);
    const helper = path || seen.size > MAX_HELPERS ? undefined : helperScope(call, scope, ctx);
    if (helper && !seen.has(helper.fn)) selectedPaths(helper, ctx, out, seen);
    if (!path) continue;
    const names = fields ? call.args.flatMap((a) => (!a.name && a.value.k === "str" ? [a.value.v] : [])) : [];
    if (names.length === 0) out.push(path);
    for (const n of names) out.push([...path, n]);
  }
}

function selectedOn(op: Op, ctx: IrCtx): string[][] {
  const out: string[][] = [];
  selectedPaths({ fn: op.fn, roots: new Map([[op.name, []]]) }, ctx, out, new Set());
  return out.filter((p) => p.length > 0 && p.every((n) => NAME.test(n) && isSafeKey(n)));
}

interface Tree {
  [field: string]: Tree;
}

function print(tree: Tree): string {
  return Object.entries(tree)
    .map(([k, sub]) => (Object.keys(sub).length > 0 ? `${k} { ${print(sub)} }` : k))
    .join(" ");
}

/** The document an sgqlc `Operation` sends, as text; undefined when `arg` holds none or its type is not known. */
export function sgqlcDocument(arg: Scoped, ctx: IrCtx): string | undefined {
  const op = operationOf(arg.expr, arg.fn, ctx);
  const type = op && operationType(op.call);
  if (!op || !type) return undefined;
  const nameArg = op.call.args.find((a) => a.name === "name")?.value;
  const name = nameArg?.k === "str" && NAME.test(nameArg.v) ? nameArg.v : undefined;
  const tree: Tree = Object.create(null) as Tree;
  for (const path of selectedOn(op, ctx)) {
    let node = tree;
    for (const field of path.map(graphqlName)) node = node[field] ??= Object.create(null) as Tree;
  }
  const header = name ? `${type} ${name}` : type;
  return Object.keys(tree).length > 0 ? `${header} { ${print(tree)} }` : name ? `${header} ` : undefined;
}
