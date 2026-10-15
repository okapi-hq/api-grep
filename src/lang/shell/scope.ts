import type { SyntaxNode } from "../tree-sitter.js";

/**
 * What a script assigns to a name: a value (`BASE="https://..."`, `export X=...`, `local u=$1`, `readonly`, `declare`),
 * an array (`HEADERS=(-H "a: b")`), a loop variable or a `read` target. Nodes stay valid while the file's tree lives.
 */
export interface Binding {
  kind: "value" | "array" | "loop" | "read";
  value?: SyntaxNode;
  elements?: SyntaxNode[];
  offset: number;
  /** Start of the function the assignment is written in; undefined at the top level. */
  fn?: number;
  /**
   * How much the value says, lowest first: 0 a value, 1 one reading the name itself (`X=${X:-default}`, `URL="$URL/v2"`),
   * 2 an argument (`X="$2"`, `X=$OPTARG`: option parsing), 3 nothing (`X=""`: an initialisation).
   */
  weight: number;
}

export interface FileScope {
  bindings: Map<string, Binding[]>;
  functions: Map<string, SyntaxNode>;
  /** The path argument of each `source` / `.` command. */
  sources: SyntaxNode[];
}

/** Start of the function a node is written in, or undefined at the top level. */
export function enclosingFn(node: SyntaxNode): number | undefined {
  for (let n = node.parent; n; n = n.parent) if (n.type === "function_definition") return n.startIndex;
  return undefined;
}

/** Commands by their first word (`curl`, `source`); a name that is not a plain word is undefined. */
export function commandName(cmd: SyntaxNode): string | undefined {
  const name = cmd.childForFieldName("name");
  const word = name?.firstNamedChild;
  return word?.type === "word" ? word.text : undefined;
}

/** The arguments of a command, without its `FOO=1` prefixes and redirections. */
export function commandArgs(cmd: SyntaxNode): SyntaxNode[] {
  return cmd.childrenForFieldName("argument").filter((c): c is SyntaxNode => !!c);
}

const ARGUMENT = /^"?\$(?:\{?[1-9@*]\}?|\{?OPTARG\}?)"?$/;

function weightOf(name: string, value: SyntaxNode | undefined): number {
  const text = value?.text ?? "";
  if (text === "" || text === '""' || text === "''") return 3;
  if (ARGUMENT.test(text)) return 2;
  return new RegExp(`\\$\\{?[#!]?${name}(?![\\w])`).test(text) ? 1 : 0;
}

function add(scope: FileScope, name: string, b: Binding): void {
  const list = scope.bindings.get(name);
  if (list) list.push(b);
  else scope.bindings.set(name, [b]);
}

function assignment(scope: FileScope, node: SyntaxNode): void {
  const name = node.childForFieldName("name");
  if (name?.type !== "variable_name" || node.children.some((c) => c?.type === "+=")) return;
  const value = node.childForFieldName("value") ?? undefined;
  const fn = enclosingFn(node);
  if (value?.type === "array") {
    add(scope, name.text, { kind: "array", elements: value.namedChildren.filter((c): c is SyntaxNode => !!c && c.type !== "comment"), offset: node.startIndex, fn, weight: 0 });
    return;
  }
  add(scope, name.text, { kind: "value", value, offset: node.startIndex, fn, weight: weightOf(name.text, value) });
}

/** Options of `read` that take a value; `-a` names an array the line is read into. */
const READ_VALUED = new Set(["-p", "-d", "-n", "-N", "-t", "-u", "-i"]);

function readTargets(scope: FileScope, cmd: SyntaxNode): void {
  const args = commandArgs(cmd);
  for (let i = 0; i < args.length; i++) {
    const t = args[i]!.text;
    if (READ_VALUED.has(t)) i++;
    else if (t === "-a" && args[i + 1]) add(scope, args[++i]!.text, { kind: "read", offset: cmd.startIndex, fn: enclosingFn(cmd), weight: 2 });
    else if (!t.startsWith("-") && /^\w+$/.test(t)) add(scope, t, { kind: "read", offset: cmd.startIndex, fn: enclosingFn(cmd), weight: 2 });
  }
}

function visit(scope: FileScope, n: SyntaxNode): void {
  if (n.type === "variable_assignment") assignment(scope, n);
  else if (n.type === "for_statement") {
    const v = n.childForFieldName("variable");
    if (v) add(scope, v.text, { kind: "loop", offset: n.startIndex, fn: enclosingFn(n), weight: 0 });
  } else if (n.type === "function_definition") {
    const name = n.childForFieldName("name");
    if (name && !scope.functions.has(name.text)) scope.functions.set(name.text, n);
  } else if (n.type === "command") {
    const name = commandName(n);
    if (name === "read") readTargets(scope, n);
    if ((name === "source" || name === ".") && commandArgs(n)[0]) scope.sources.push(commandArgs(n)[0]!);
  }
}

/**
 * Every node of a tree, depth first, without recursion (a hostile script can nest deeply). What the parser could not
 * read (an `ERROR` node) is left out: the rest of the file is still read.
 */
export function* nodesOf(root: SyntaxNode): Generator<SyntaxNode> {
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type === "ERROR") continue;
    yield n;
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i);
      if (c) stack.push(c);
    }
  }
}

export function collectScope(root: SyntaxNode): FileScope {
  const scope: FileScope = { bindings: new Map(), functions: new Map(), sources: [] };
  for (const n of nodesOf(root)) visit(scope, n);
  return scope;
}

/** The first of the bindings that says the most (see `Binding.weight`). */
function strongest(list: Binding[]): Binding | undefined {
  return list.reduce<Binding | undefined>((best, b) => (!best || b.weight < best.weight ? b : best), undefined);
}

/**
 * The binding a use of `name` reads: in its own function, the latest before it (else the function's first); else the
 * top-level assignment that says the most, else one made in a function. Of values assigned in branches the first is
 * read, as in the other languages.
 */
export function bindingFor(scope: FileScope, name: string, offset: number, fn: number | undefined): Binding | undefined {
  // `X=""`: an initialisation; the value comes later, from where the scan does not see (options, a config file)
  const all = scope.bindings.get(name)?.filter((b) => b.weight < 3);
  if (!all?.length) return undefined;
  if (fn !== undefined) {
    const own = all.filter((b) => b.fn === fn);
    const before = own.filter((b) => b.offset < offset);
    if (own.length > 0) return before[before.length - 1] ?? own[0];
  }
  return strongest(all.filter((b) => b.fn === undefined)) ?? strongest(all);
}
