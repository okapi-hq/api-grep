import { Node, SyntaxKind, type CallExpression, type Expression, type Project } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import { getProp } from "../ast/object.js";
import type { Callee, MethodSpec, RegistryEntry } from "../types.js";
import { describeCallee } from "./callee.js";

/**
 * SDKs configured once, away from their calls (`Bugsnag.start({ endpoints })` at startup, then `Bugsnag.notify(err)`
 * anywhere): a method's base URL from the client's construction, or from the project's one setup call of the package.
 */

/** The value at a place of the arguments: `0.endpoints.notify`. */
export function argPlace(args: readonly Expression[], place: string): Expression | undefined {
  const [idx, ...props] = place.split(".");
  return props.reduce<Expression | undefined>((e, key) => getProp(e, key), args[Number(idx)]);
}

/** Whether the call sends nothing as the code configures it: `spec.offWhen` set to a literal `false`. */
export function turnedOff(args: readonly Expression[], spec: MethodSpec): boolean {
  const value = spec.offWhen ? argPlace(args, spec.offWhen) : undefined;
  return !!value && unwrap(value).getKind() === SyntaxKind.FalseKeyword;
}

const memo = new WeakMap<Project, Map<string, CallExpression[]>>();

/** The project's calls of the package's own setup functions (`Bugsnag.start(...)`), as the code imports it. */
function setupCalls(project: Project, pkg: string, names: string[]): CallExpression[] {
  let byKey = memo.get(project);
  if (!byKey) memo.set(project, (byKey = new Map<string, CallExpression[]>()));
  const key = `${pkg}\0${names.join(",")}`;
  const known = byKey.get(key);
  if (known) return known;
  const found: CallExpression[] = [];
  for (const sf of project.getSourceFiles()) {
    if (!sf.getFullText().includes(pkg)) continue;
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      if (!Node.isPropertyAccessExpression(expr) || !names.includes(expr.getName())) continue;
      const c = describeCallee(call);
      if (c.package === pkg && !c.instance && c.chain.length === 1) found.push(call);
    }
  }
  byKey.set(key, found);
  return found;
}

/** The base URL `spec.setupUrl` names: in the client's construction, else in the project's one setup call. */
export function setupBaseUrl(node: Node, callee: Callee, reg: RegistryEntry, spec: MethodSpec): Expression | undefined {
  if (!spec.setupUrl) return undefined;
  const ctor = callee.instance?.chain.at(-1);
  if (callee.instance) return ctor && reg.instance?.names.includes(ctor) ? argPlace(callee.instance.args, spec.setupUrl) : undefined;
  if (!reg.setup || !callee.package) return undefined;
  const calls = setupCalls(node.getProject(), callee.package, reg.setup);
  return calls.length === 1 ? argPlace(calls[0]!.getArguments() as Expression[], spec.setupUrl) : undefined;
}
