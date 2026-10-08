import { Node, type CallExpression, type Expression } from "ts-morph";
import { detectFile, detectNode, type WrapperCandidate } from "../detect/index.js";
import { declarationsOf } from "../detect/options.js";
import type { Registry } from "../detect/registry/index.js";
import type { Unfollowed } from "../detect/unfollowed.js";
import type { RawCall, Subst } from "../types.js";
import { callShift, wrapperFunction, type FunctionLike } from "./function.js";

const MAX_INNER = 3;

function wrapperName(fn: FunctionLike): string {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) {
    const cls = Node.isMethodDeclaration(fn) ? fn.getParent() : undefined;
    const owner = cls && Node.isClassDeclaration(cls) ? `${cls.getName() ?? "class"}.` : "";
    return `${owner}${fn.getName() ?? "anonymous"}`;
  }
  const parent = fn.getParent();
  return Node.isVariableDeclaration(parent) ? parent.getName() : "anonymous";
}

/** True when at least one of the wrapper's parameters is referenced by the inner call's url/method/body/options. */
function paramsFlowInto(fn: FunctionLike, raw: RawCall): boolean {
  const params = new Set<Node>(fn.getParameters());
  const exprs = [raw.urlExpr, raw.baseUrlExpr, raw.methodExpr, raw.bodyExpr, raw.optionsExpr, raw.queryExpr, ...(raw.sdk?.args ?? [])].filter((e): e is Expression => !!e);
  return exprs.some((e) => referencesParam(e, params, 0));
}

/** Whether an expression references one of `params`, following local variables one level. */
function referencesParam(e: Node, params: Set<Node>, depth: number): boolean {
  const idents = [e, ...e.getDescendants()].filter(Node.isIdentifier);
  for (const id of idents) {
    for (const decl of declarationsOf(id)) {
      const param = Node.isParameterDeclaration(decl) ? decl : Node.isBindingElement(decl) ? decl.getFirstAncestor(Node.isParameterDeclaration) : undefined;
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
  inner: Map<Node, RawCall[]>;
  nested: Map<Node, string | null>;
}

/** HTTP calls in the wrapper's body that its parameters flow into. */
function innerCalls(fn: FunctionLike, registry: Registry, caches: Caches): RawCall[] {
  let inner = caches.inner.get(fn);
  if (!inner) {
    const body = fn.getBody?.() ?? fn;
    inner = detectFile(fn.getSourceFile(), registry, body)
      .calls.filter((c) => !c.via && paramsFlowInto(fn, c))
      .slice(0, MAX_INNER);
    caches.inner.set(fn, inner);
  }
  return inner;
}

/** Name of a wrapper that `fn` calls with its own parameters, when `fn` has no HTTP call of its own (`tlsFetch` -> `doFetch`). */
function nestedWrapper(fn: FunctionLike, registry: Registry, caches: Caches): string | undefined {
  const hit = caches.nested.get(fn);
  if (hit !== undefined) return hit ?? undefined;
  caches.nested.set(fn, null);
  const params = new Set<Node>(fn.getParameters());
  for (const c of detectFile(fn.getSourceFile(), registry, fn.getBody?.() ?? fn).candidates) {
    const g = wrapperFunction(c.callee);
    if (!g || g === fn || !c.node.getArguments().some((a) => referencesParam(a, params, 0))) continue;
    if (innerCalls(g, registry, caches).length === 0) continue;
    caches.nested.set(fn, wrapperName(g));
    return wrapperName(g);
  }
  return undefined;
}

/**
 * Expands one-hop wrappers: calls to local functions whose body contains a detected HTTP call. A call to a wrapper
 * of a wrapper is not expanded (the inner wrapper's call site is) and comes back as `wrapper-depth`.
 */
export function expandWrappers(candidates: WrapperCandidate[], registry: Registry): { calls: RawCall[]; unfollowed: Unfollowed[] } {
  const caches: Caches = { inner: new Map(), nested: new Map() };
  const out: RawCall[] = [];
  const unfollowed: Unfollowed[] = [];
  for (const cand of candidates) {
    const fn = wrapperFunction(cand.callee);
    if (!fn) continue;
    const inner = innerCalls(fn, registry, caches);
    if (inner.length === 0) {
      const via = nestedWrapper(fn, registry, caches);
      if (via) unfollowed.push({ node: cand.node, reason: "wrapper-depth", via });
      continue;
    }
    const subst = substitutionFor(fn, cand.node, callShift(cand.callee));
    const via = `wrapper:${wrapperName(fn)}`;
    for (const raw of inner) {
      const redetected = detectNode(raw.node, registry, { subst }).raw ?? raw;
      out.push({ ...redetected, node: cand.node, via, subst });
    }
  }
  return { calls: out, unfollowed };
}
