import type { Part } from "../../types.js";
import type { SyntaxNode } from "../tree-sitter.js";
import { argvOf, type Argv } from "./argv.js";
import { parseCurl } from "./curl.js";
import { parseHttpie } from "./httpie.js";
import type { ShellRequest } from "./request.js";
import { commandName, enclosingFn, nodesOf, type FileScope } from "./scope.js";
import { parseWget } from "./wget.js";
import { wordCtx } from "./words.js";
import { branchTaken } from "./branches.js";

/** A request a command sends, where it is reported: the command, or a wrapper function's call site (`via`). */
export interface Found {
  req: ShellRequest;
  line: number;
  col: number;
  via?: string;
}

function requestsOf(argv: Argv, scope: FileScope): ShellRequest[] {
  // a function named like the program (`curl() { command curl --retry 3 "$@"; }`) is what a plain call runs
  if (argv.direct && scope.functions.has(argv.name)) return [];
  if (argv.name === "curl") return parseCurl(argv.args, argv.opaque);
  if (argv.name === "wget") return parseWget(argv.args, argv.opaque);
  if (argv.name === "http" || argv.name === "https") return parseHttpie(argv.args, argv.opaque, argv.name);
  return [];
}

const CLIENTS = new Set(["curl", "wget", "http", "https"]);

const at = (n: SyntaxNode) => ({ line: n.startPosition.row + 1, col: n.startPosition.column + 1 });

function functionAt(start: number, scope: FileScope): string | undefined {
  for (const [name, f] of scope.functions) if (f.startIndex === start) return name;
  return undefined;
}

/**
 * One level of wrapper: a function sending a request built from its arguments (`api() { curl "$BASE/$1" "${@:2}"; }`)
 * is also reported at each call of it in the file, its arguments read there (`api repos/x -X POST`).
 */
function expandWrapper(cmd: SyntaxNode, name: string, calls: SyntaxNode[], scope: FileScope): Found[] {
  const out: Found[] = [];
  const own = enclosingFn(cmd);
  for (const site of calls) {
    if (enclosingFn(site) === own) continue;
    const positional: Part[][] = argvOf(site, wordCtx(scope, site)).args;
    const ctx = wordCtx(scope, cmd, positional);
    if (!branchTaken(cmd, ctx)) continue;
    for (const req of requestsOf(argvOf(cmd, ctx), scope)) out.push({ req, ...at(site), via: `wrapper:${name}` });
  }
  return out;
}

/** Every request the commands of a file send, `$(...)` and backticks included; text in strings and heredocs is not run. */
export function extractRequests(root: SyntaxNode, scope: FileScope, wrappers: boolean): Found[] {
  const commands = [...nodesOf(root)].filter((n) => n.type === "command");
  const calls = new Map<string, SyntaxNode[]>();
  for (const c of commands) {
    const name = commandName(c);
    if (name && scope.functions.has(name)) calls.set(name, [...(calls.get(name) ?? []), c]);
  }
  const out: Found[] = [];
  for (const cmd of commands) {
    const ctx = wordCtx(scope, cmd);
    const argv = argvOf(cmd, ctx);
    if (!CLIENTS.has(argv.name)) continue;
    out.push(...requestsOf(argv, scope).map((req) => ({ req, ...at(cmd) })));
    // the URL may come from the arguments only (`get() { curl -fsS "$@"; }`): the call sites still say it
    const fn = enclosingFn(cmd);
    const wrapper = wrappers && ctx.reads?.positional && fn !== undefined ? functionAt(fn, scope) : undefined;
    if (wrapper) out.push(...expandWrapper(cmd, wrapper, calls.get(wrapper) ?? [], scope));
  }
  return out;
}
