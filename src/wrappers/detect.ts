import { Node, type CallExpression, type Expression } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import { isFunctionLike, returnsOf, type FunctionLike } from "../ast/function.js";
import { declarationsOf } from "../ast/object.js";
import { callShift, wrapperFunction } from "../detect/callee.js";
import { detectFile, detectNode, type DetectResult, type WrapperCandidate } from "../detect/index.js";
import type { ReceiverResolver } from "../detect/receiver.js";
import type { Registry } from "../detect/registry/index.js";
import type { Unfollowed } from "../detect/unfollowed.js";
import type { RawCall, SdkMatch, Subst } from "../types.js";

const MAX_INNER = 3;
/** Wrappers between a call site and its HTTP call. */
const MAX_WRAPPERS = 6;

/** A function's own name, else the name it is called by (`send` for an arrow a factory returned). */
function wrapperName(fn: FunctionLike, call?: CallExpression): string {
  const own = declaredName(fn);
  if (own !== "anonymous" || !call) return own;
  const e = call.getExpression();
  return Node.isIdentifier(e) ? e.getText() : Node.isPropertyAccessExpression(e) ? e.getName() : own;
}

function declaredName(fn: FunctionLike): string {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) {
    const cls = Node.isMethodDeclaration(fn) ? fn.getParent() : undefined;
    const owner = cls && Node.isClassDeclaration(cls) ? `${cls.getName() ?? "class"}.` : "";
    return `${owner}${fn.getName() ?? "anonymous"}`;
  }
  // `const send = useCallback(async (url) => ..., deps)`: the variable the hook's result is kept in
  let parent = fn.getParent();
  if (Node.isCallExpression(parent)) parent = parent.getParent();
  if (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent)) return parent.getName();
  return "anonymous";
}

/**
 * SDK arguments the request is built from (path, query, body), and the calls of a fluent request builder. The error given to `captureException` is not one: a
 * `reportError(err)` wrapper sends the same request from every caller, so its call sites are not calls of their own.
 */
function requestArgs(sdk: SdkMatch): Expression[] {
  const { spec } = sdk;
  const idx = [spec.bodyArg, spec.queryArg, spec.routeArg, spec.routeHelperArg, ...(spec.pathArgs ?? []), ...(spec.fieldArgs ?? []).map((f, i) => (f ? i : undefined))];
  for (const from of Object.values(spec.params ?? {})) {
    const m = /^(?:arg|ref|fn):(\d+)/.exec(from);
    if (m) idx.push(Number(m[1]));
  }
  // a fluent request builder's calls (`api(path).top(n)`) all build the request
  return [...idx.flatMap((i) => (i !== undefined && sdk.args[i] ? [sdk.args[i]] : [])), ...(sdk.steps ?? []).flatMap((s) => s.args)];
}

/** True when at least one of the wrapper's parameters is referenced by what the inner call's request is built from. */
function paramsFlowInto(fn: FunctionLike, raw: RawCall): boolean {
  const params = flowParams(fn);
  const exprs = [raw.urlExpr, raw.baseUrlExpr, raw.methodExpr, raw.bodyExpr, raw.optionsExpr, raw.queryExpr, ...(raw.sdk ? requestArgs(raw.sdk) : [])].filter((e): e is Expression => !!e);
  return exprs.some((e) => referencesParam(e, params, 0));
}

/**
 * The parameters a wrapper's request may read from its call: its own, and those of the factory that returns it
 * (`createReleaser(req, id)` returns `async () => release(req, id)`), which the factory's call gives (`Callee.closure`).
 */
function flowParams(fn: FunctionLike): Set<Node> {
  const params = new Set<Node>(fn.getParameters());
  const outer = fn.getParent()?.getFirstAncestor((a) => isFunctionLike(a));
  if (outer && isFunctionLike(outer) && returnsOf(outer).some((r) => unwrap(r) === (fn as Node))) for (const p of outer.getParameters()) params.add(p);
  return params;
}

/** Whether an expression references one of `params`, following local variables one level. */
function referencesParam(e: Node, params: Set<Node>, depth: number): boolean {
  const idents = [e, ...e.getDescendants()].filter(Node.isIdentifier);
  for (const id of idents) {
    for (const decl of declarationsOf(id)) {
      const param = Node.isParameterDeclaration(decl) ? decl : Node.isBindingElement(decl) ? decl.getFirstAncestor((a) => Node.isParameterDeclaration(a)) : undefined;
      if (param && params.has(param)) return true;
      const init = Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
      if (init && depth < 1 && referencesParam(init, params, depth + 1)) return true;
    }
  }
  return false;
}

/** Maps the wrapper's parameters to the caller's arguments; a TypeScript `this` parameter is not a real argument. */
function substitutionFor(fn: FunctionLike, call: CallExpression, shift: number): Subst {
  const subst: Subst = new Map();
  const args = (call.getArguments() as Expression[]).slice(shift);
  const params = fn.getParameters().filter((p) => p.getName() !== "this");
  params.forEach((p, i) => {
    const arg = args[i] ?? p.getInitializer();
    if (arg && !p.isRestParameter()) subst.set(p, arg);
  });
  return subst;
}

interface Caches {
  receivers?: ReceiverResolver;
  bodies: Map<Node, DetectResult>;
  direct: Map<Node, RawCall[]>;
  chains: Map<Node, Map<number, Expansion[]>>;
}

/** An HTTP call reached through wrappers: the substitutions of the inner wrappers it went through, and their names. */
interface Expansion {
  raw: RawCall;
  subst: Subst;
  via: string[];
}

function bodyOf(fn: FunctionLike, registry: Registry, caches: Caches): DetectResult {
  let found = caches.bodies.get(fn);
  if (!found) {
    // an arrow whose body is the call itself (`(path) => fetch(base + path)`): the call is no descendant of its body
    const body = fn.getBody?.();
    found = detectFile(fn.getSourceFile(), registry, body && !Node.isExpression(body) ? body : fn, caches.receivers);
    caches.bodies.set(fn, found);
  }
  return found;
}

/**
 * A call in a function `fn` returns (`makeSender(base)` returns `(path) => fetch(base + path)`): calling `fn` makes the
 * function, not the request; the request is made where that function is called (`fn-value.ts`).
 */
function inReturnedFunction(fn: FunctionLike, node: Node): boolean {
  const inner = node.getFirstAncestor((a) => a === fn || isFunctionLike(a));
  return !!inner && inner !== fn && returnsOf(fn).some((r) => unwrap(r) === inner);
}

/** HTTP calls in the wrapper's body that its parameters flow into. */
function directCalls(fn: FunctionLike, registry: Registry, caches: Caches): RawCall[] {
  let direct = caches.direct.get(fn);
  if (!direct) {
    direct = bodyOf(fn, registry, caches)
      .calls.filter((c) => !c.via && paramsFlowInto(fn, c) && !inReturnedFunction(fn, c.node))
      .slice(0, MAX_INNER);
    caches.direct.set(fn, direct);
  }
  return direct;
}

/** Wrappers that `fn` calls with its own parameters (`tlsFetch(url)` -> `doFetch(url, init)`), each with the call. */
function innerWrappers(fn: FunctionLike, registry: Registry, caches: Caches): { call: CallExpression; g: FunctionLike; shift: number; closure?: Subst }[] {
  const params = flowParams(fn);
  return bodyOf(fn, registry, caches).candidates.flatMap((c) => {
    const g = wrapperFunction(c.callee);
    const flows = c.node.getArguments().some((a) => referencesParam(a, params, 0));
    return g && g !== fn && flows && !inReturnedFunction(fn, c.node) ? [{ call: c.node, g, shift: callShift(c.callee), closure: c.callee.closure }] : [];
  });
}

/**
 * The HTTP calls reached through `fn`: its own, else those of the wrappers it calls with its parameters, substituted at
 * each inner call, through `budget` wrappers at most (`fn` counts). The result does not depend on who calls `fn`, so it
 * is cached per budget; recursion ends as the budget does, and a wrapper reached again on a cycle is read with what is
 * left of it, never with a placeholder of its own expansion.
 */
function expansionsOf(fn: FunctionLike, budget: number, registry: Registry, caches: Caches): Expansion[] {
  const direct = directCalls(fn, registry, caches);
  if (direct.length > 0) return direct.map((raw) => ({ raw, subst: new Map(), via: [] }));
  if (budget <= 1) return [];
  let byBudget = caches.chains.get(fn);
  if (!byBudget) caches.chains.set(fn, (byBudget = new Map<number, Expansion[]>()));
  let chains = byBudget.get(budget);
  if (!chains) {
    chains = innerWrappers(fn, registry, caches)
      .flatMap(({ call, g, shift, closure }) =>
        expansionsOf(g, budget - 1, registry, caches).map((e) => ({ raw: e.raw, subst: new Map([...e.subst, ...(closure ?? []), ...substitutionFor(g, call, shift)]), via: [wrapperName(g, call), ...e.via] })),
      )
      .slice(0, MAX_INNER);
    byBudget.set(budget, chains);
  }
  return chains;
}

/** The first wrapper of a chain longer than `MAX_WRAPPERS`, named so the call site can be listed as not followed. */
function deeperWrapper(fn: FunctionLike, registry: Registry, caches: Caches): string | undefined {
  const hit = innerWrappers(fn, registry, caches).find(({ g }) => expansionsOf(g, MAX_WRAPPERS, registry, caches).length > 0);
  return hit ? wrapperName(hit.g, hit.call) : undefined;
}

/**
 * Expands wrappers at their call sites, up to `MAX_WRAPPERS` deep (`page()` -> `proxy()` -> `client()` -> `send()` ->
 * `fetch`): calls to local functions whose body makes an HTTP call, or calls a wrapper that does, with their
 * parameters. Longer chains come back as `wrapper-depth`.
 */
export function expandWrappers(candidates: WrapperCandidate[], registry: Registry, receivers?: ReceiverResolver): { calls: RawCall[]; unfollowed: Unfollowed[] } {
  const caches: Caches = { receivers, bodies: new Map(), direct: new Map(), chains: new Map() };
  const out: RawCall[] = [];
  const unfollowed: Unfollowed[] = [];
  for (const cand of candidates) {
    const fn = wrapperFunction(cand.callee);
    if (!fn) continue;
    const expansions = expansionsOf(fn, MAX_WRAPPERS, registry, caches);
    if (expansions.length === 0) {
      const via = deeperWrapper(fn, registry, caches);
      if (via) unfollowed.push({ node: cand.node, reason: "wrapper-depth", via });
      continue;
    }
    const outer = new Map([...(cand.callee.closure ?? []), ...substitutionFor(fn, cand.node, callShift(cand.callee))]);
    for (const e of expansions) {
      const subst: Subst = new Map([...e.subst, ...outer]);
      const inner = e.raw.node;
      const redetected = (Node.isCallExpression(inner) || Node.isNewExpression(inner) ? detectNode(inner, registry, { subst }).raw : null) ?? e.raw;
      out.push({ ...redetected, node: cand.node, via: `wrapper:${[wrapperName(fn, cand.node), ...e.via].join(">")}`, subst });
    }
  }
  return { calls: out, unfollowed };
}
