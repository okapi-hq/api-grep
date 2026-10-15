import type { Arg, Expr } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { lowerArgs } from "./lower-expr.js";
import { packageOf, type GoState } from "./names.js";

/**
 * Standard library calls the engine reads as values rather than calls: environment reads, `fmt.Sprintf`, path joins,
 * and functions whose value is their first argument for a URL or a body (`bytes.NewBuffer(b)`, `strings.TrimSuffix`);
 * and the SDK helpers that only wrap a value (`openai.Int(512)`).
 */

/** Functions whose value, for a URL or a body, is their first argument; by import path. */
const FIRST_ARG: Record<string, Set<string>> = {
  bytes: new Set(["NewBuffer", "NewBufferString", "NewReader", "TrimSpace", "TrimSuffix", "TrimRight", "Clone"]),
  strings: new Set(["NewReader", "TrimSpace", "TrimSuffix", "TrimRight", "Clone"]),
  "net/url": new Set(["PathEscape", "QueryEscape"]),
};

/** SDK helpers that wrap a value as an optional field (`openai.Int(512)`, `anthropic.String(s)`, `genai.Ptr(0.2)`). */
const WRAPPERS = new Set(["F", "String", "Int", "Float", "Bool", "Opt", "Ptr", "NewOpt"]);
const WRAPPING_SDKS = ["github.com/openai/openai-go", "github.com/anthropics/anthropic-sdk-go", "google.golang.org/genai"];

const wrapping = (pkg: string): boolean => WRAPPING_SDKS.some((root) => pkg === root || pkg.startsWith(`${root}/`));

const literal = (a: Arg | undefined): string | undefined => (a && !a.name && !a.spread && a.value.k === "str" ? a.value.v : undefined);

/** `path.Join(a, b)`, `url.JoinPath(base, "v1")`: the elements with `/` between them. */
function joined(args: Arg[], sep: Expr): Expr | undefined {
  if (args.length === 0 || args.some((a) => a.name || a.spread)) return undefined;
  return { k: "concat", parts: args.flatMap((a, i) => (i ? [sep, a.value] : [a.value])) };
}

function osCall(name: string, args: Arg[]): Expr | undefined {
  const env = (name === "Getenv" || name === "LookupEnv") && args.length === 1 ? literal(args[0]) : undefined;
  return env !== undefined ? { k: "env", name: env } : undefined;
}

function special(pkg: string, name: string, args: Arg[]): Expr | undefined {
  if (pkg === "os") return osCall(name, args);
  if (wrapping(pkg)) return WRAPPERS.has(name) && args.length === 1 && !args[0]!.name && !args[0]!.spread ? args[0]!.value : undefined;
  if (pkg === "fmt" && name === "Sprintf" && args[0] && !args[0].spread) return { k: "format", style: "printf", template: args[0].value, args: args.slice(1) };
  if (FIRST_ARG[pkg]?.has(name) && args[0] && !args[0].spread) return args[0].value;
  if ((pkg === "path" && name === "Join") || (pkg === "net/url" && name === "JoinPath")) return joined(args, { k: "str", v: "/" });
  // `strings.Join([]string{base, "v1"}, "/")`
  const items = pkg === "strings" && name === "Join" && args.length === 2 && args[0]!.value.k === "list" ? args[0]!.value.items : undefined;
  return items ? joined(items.map((value) => ({ value })), args[1]!.value) : undefined;
}

/**
 * A call of a standard library function read as a value (`value`), else undefined; `args` are the arguments once
 * lowered, for the caller to make the call of when there is no value (their calls are recorded once).
 */
export function packageCall(fnNode: SyntaxNode, argsNode: SyntaxNode | undefined, st: GoState): { value?: Expr; args: Arg[] } | undefined {
  if (fnNode.type !== "selector_expression") return undefined;
  const operand = field(fnNode, "operand");
  const pkg = operand?.type === "identifier" ? packageOf(operand.text, st) : undefined;
  const name = field(fnNode, "field")?.text;
  if (!pkg || !name || !(pkg in FIRST_ARG || ["os", "fmt", "path", "strings", "net/url"].includes(pkg) || (wrapping(pkg) && WRAPPERS.has(name)))) return undefined;
  const args = lowerArgs(argsNode, st);
  if (argsNode && named(argsNode).some((a) => a.type === "variadic_argument") && name !== "Sprintf") return { args };
  return { value: special(pkg, name, args), args };
}
