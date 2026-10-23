import { Node, type CallExpression, type Expression, type NewExpression, type PropertyAccessExpression } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import { declarationsOf } from "../ast/object.js";
import type { Callee, MethodSpec, RawCall, RegistryEntry, Step } from "../types.js";
import { describeCallee } from "./callee.js";
import type { Registry } from "./registry/index.js";

/** Longer chains are not request builders anyone writes; the walk stops there. */
const MAX_STEPS = 24;

/** The call a `const` / `let` holds from its declaration (`const req = client.api(path)`), when it holds one. */
function heldCall(e: Expression): Expression {
  const decl = Node.isIdentifier(e) ? declarationsOf(e)[0] : undefined;
  const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
  return init && Node.isCallExpression(unwrap(init)) ? unwrap(init) : e;
}

/**
 * The calls a method is called after, from the registry's `steps.start` on (`client.api(path).select(f).top(10)` before
 * `.get()`), in order; also through a variable holding the start of the chain. Undefined when the chain does not
 * start with that call.
 */
function stepsOf(node: CallExpression, starts: Set<string>): { steps: Step[]; start: CallExpression } | undefined {
  const steps: Step[] = [];
  let e = unwrap(node.getExpression());
  while (steps.length < MAX_STEPS && Node.isPropertyAccessExpression(e)) {
    const call = heldCall(unwrap(e.getExpression()));
    if (!Node.isCallExpression(call)) return undefined;
    const callee = unwrap(call.getExpression());
    if (!Node.isPropertyAccessExpression(callee)) return undefined;
    steps.unshift({ name: callee.getName(), args: call.getArguments() as Expression[] });
    if (starts.has(callee.getName())) return { steps, start: call };
    e = callee;
  }
  return undefined;
}

const STARTS = new WeakMap<Registry, Set<string>>();

/**
 * The client of a fluent chain longer than `describeCallee` follows (six calls: `api(p).version(v).filter(f)...get()`),
 * read from the chain's start call; undefined when the chain starts with none of the registries' `steps.start`.
 */
export function fluentCallee(node: CallExpression | NewExpression, registry: Registry): Callee | undefined {
  let starts = STARTS.get(registry);
  if (!starts) STARTS.set(registry, (starts = new Set(registry.entries().flatMap((e) => (e.steps ? [e.steps.start] : [])))));
  const found = starts.size > 0 && Node.isCallExpression(node) ? stepsOf(node, starts) : undefined;
  const callee = found ? describeCallee(found.start) : undefined;
  return callee?.package && registry.allByPackage(callee.package).some((e) => e.steps) ? callee : undefined;
}

/** Key parts against a key's: `*` is one name, `**` any number of them (none too). */
function fits(p: string[], parts: string[]): boolean {
  const deep = p.indexOf("**");
  if (deep < 0) return p.length === parts.length && p.every((x, i) => x === "*" || x === parts[i]);
  const tail = p.length - deep - 1;
  return parts.length >= deep + tail && fits(p.slice(0, deep), parts.slice(0, deep)) && fits(p.slice(deep + 1), parts.slice(parts.length - tail));
}

/** `api("https://graph.microsoft.com/beta/me")`: a URL of its own, host and version included, rather than a path. */
function absoluteUrl(e: Expression | undefined): boolean {
  const u = e ? unwrap(e) : undefined;
  if (!u) return false;
  const text = Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u) ? u.getLiteralText() : Node.isTemplateExpression(u) ? u.getHead().getLiteralText() : "";
  return /^https?:\/\//i.test(text);
}

/**
 * A method of a fluent request builder (`steps` in the registry): the key its steps and its name make (`api.**.get`),
 * and its spec; the steps ride on the call for `step:<name>:<N>` params, and those of `steps.query` set its query.
 */
export function fluentMatch(node: CallExpression, reg: RegistryEntry): { key: string; spec: MethodSpec; steps: Step[] } | undefined {
  const callee = unwrap(node.getExpression());
  const steps = reg.steps && reg.methods && Node.isPropertyAccessExpression(callee) ? stepsOf(node, new Set([reg.steps.start]))?.steps : undefined;
  if (!steps) return undefined;
  const parts = [...steps.map((s) => s.name), (callee as PropertyAccessExpression).getName()];
  const key = parts.join(".");
  const found = Object.entries(reg.methods!).find(([k]) => k === key || (k.includes("*") && fits(k.split("."), parts)));
  return found ? { key, spec: found[1], steps } : undefined;
}

/** The steps on the call that `fluentMatch` matched: the URL a start call names whole, the query the steps set. */
export function withSteps(raw: RawCall, steps: Step[], reg: RegistryEntry): RawCall {
  raw.sdk = { ...raw.sdk!, steps };
  const start = steps[0]!.args[0];
  if (absoluteUrl(start)) raw.urlExpr = start;
  const query = reg.steps?.query ?? {};
  raw.stepQuery = steps.flatMap((s): NonNullable<RawCall["stepQuery"]> => {
    if (reg.steps?.queryObject?.includes(s.name)) return s.args[0] ? [{ value: s.args[0] }] : [];
    const name = Object.hasOwn(query, s.name) ? query[s.name] : undefined;
    return name ? [{ name, value: s.args[0] }] : [];
  });
  return raw;
}
