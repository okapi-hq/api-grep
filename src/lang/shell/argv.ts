import { staticText } from "../../resolve/parts.js";
import type { Part } from "../../types.js";
import type { SyntaxNode } from "../tree-sitter.js";
import { bindingFor, commandArgs } from "./scope.js";
import { spreadOf, wordParts, type WordCtx } from "./words.js";

/** A command line as words: the program, its arguments, and whether some arguments could not be read (`"${opts[@]}"`). */
export interface Argv {
  name: string;
  args: Part[][];
  opaque: boolean;
  /** The name is the command's own first word, not reached through `command`, `sudo`… (a function of that name runs). */
  direct: boolean;
}

/** Commands that run the command after them, with their options that take a value. */
const RUNNERS: Record<string, { valued: Set<string>; positional?: number }> = {
  sudo: { valued: new Set(["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U"]) },
  env: { valued: new Set(["-u", "-C", "-S"]) },
  command: { valued: new Set() },
  exec: { valued: new Set(["-a"]) },
  builtin: { valued: new Set() },
  nohup: { valued: new Set() },
  time: { valued: new Set(["-f", "-o"]) },
  nice: { valued: new Set(["-n"]) },
  // `timeout 30 curl ...`, `timeout -k 5 30 curl ...`: one duration before the command
  timeout: { valued: new Set(["-s", "-k"]), positional: 1 },
};

/** Arguments that are one unquoted value the scan cannot read (`$OPTS`): a URL only when no other argument is one. */
export const UNQUOTED = new WeakSet<Part[]>();

const words = (text: string): Part[][] =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => [{ kind: "static", text: t, viaConst: true }]);

/** The words one argument expands to: `"$@"` and `"${ARR[@]}"` to several, an unquoted `$OPTS` split on spaces. */
function expand(node: SyntaxNode, ctx: WordCtx, out: Argv): void {
  const spread = spreadOf(node);
  if (spread?.positional) {
    if (ctx.reads) ctx.reads.positional = true;
    if (ctx.positional) out.args.push(...ctx.positional.slice(Math.max(0, (spread.from ?? 1) - 1)));
    else out.opaque = true;
    return;
  }
  if (spread?.array !== undefined) {
    const b = bindingFor(ctx.scope, spread.array, ctx.offset, ctx.fn);
    if (b?.kind === "array" && b.elements) {
      const inner: WordCtx = { ...ctx, offset: b.offset, fn: b.fn, depth: ctx.depth + 1 };
      for (const e of b.elements) out.args.push(wordParts(e, inner).map((p) => (p.kind === "static" ? { ...p, viaConst: true } : p)));
    } else out.opaque = true;
    return;
  }
  const parts = wordParts(node, ctx);
  const text = staticText(parts);
  const bare = node.type === "simple_expansion" || node.type === "expansion";
  if (bare && text !== undefined && /\s/.test(text.trim())) out.args.push(...words(text));
  else out.args.push(parts);
  // `curl ${CURL_OPTS} "$url"`: an unquoted value the scan cannot read is split into words, options as often as a URL
  if (bare && text === undefined) UNQUOTED.add(parts);
}

/** Drops `sudo`, `env A=1`, `timeout 30`, `command`… in front of the program; a path keeps its last element. */
function unwrapRunners(argv: Argv): Argv {
  for (let guard = 0; guard < 8; guard++) {
    const runner = RUNNERS[argv.name];
    if (!runner) break;
    let i = 0;
    let positional = runner.positional ?? 0;
    for (; i < argv.args.length; i++) {
      const t = staticText(argv.args[i]!) ?? "";
      if (runner.valued.has(t)) i++;
      else if (t.startsWith("-") || (argv.name === "env" && /^\w+=/.test(t))) continue;
      else if (positional > 0) positional--;
      else break;
    }
    const next = argv.args[i];
    const name = next ? staticText(next) : undefined;
    if (!name) return { ...argv, name: "" };
    argv = { name: name.split("/").pop()!, args: argv.args.slice(i + 1), opaque: argv.opaque, direct: false };
  }
  return argv;
}

/**
 * The words of a command: its name read as a word (`$CURL` set to `"curl -sS"` in the file runs curl), its arguments
 * expanded, and runners such as `sudo` and `timeout` dropped.
 */
export function argvOf(cmd: SyntaxNode, ctx: WordCtx): Argv {
  const nameNode = cmd.childForFieldName("name")?.firstNamedChild;
  const named = nameNode ? (staticText(wordParts(nameNode, ctx)) ?? "") : "";
  const head = named.trim().split(/\s+/);
  const out: Argv = { name: (head[0] ?? "").split("/").pop()!, args: words(head.slice(1).join(" ")), opaque: false, direct: true };
  for (const a of commandArgs(cmd)) expand(a, ctx, out);
  return unwrapRunners(out);
}
