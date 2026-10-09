import { Node, type CallExpression, type Expression } from "ts-morph";
import { type FunctionLike } from "../ast/function.js";
import { declarationsOf } from "../ast/object.js";
import { callShift, wrapperFunction } from "../detect/callee.js";
import { detectFile, detectNode, type DetectResult, type WrapperCandidate } from "../detect/index.js";
import type { Registry } from "../detect/registry/index.js";
import type { Unfollowed } from "../detect/unfollowed.js";
import type { RawCall, SdkMatch, Subst } from "../types.js";

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

/**
 * SDK arguments the request is built from (path, query, body). The error given to `captureException` is not one: a
 * `reportError(err)` wrapper sends the same request from every caller, so its call sites are not calls of their own.
 */
function requestArgs(sdk: SdkMatch): Expression[] {
  const { spec } = sdk;
  const idx = [spec.bodyArg, spec.queryArg, spec.routeArg, ...(spec.pathArgs ?? [])];
  for (const from of Object.values(spec.params ?? {})) {
    const m = /^(?:arg|ref|fn):(\d+)/.exec(from);
    if (m) idx.push(Number(m[1]));
  }
  return idx.flatMap((i) => (i !== undefined && sdk.args[i] ? [sdk.args[i]] : []));
}

/** True when at least one of the wrapper's parameters is referenced by what the inner call's request is built from. */
function paramsFlowInto(fn: FunctionLike, raw: RawCall): boolean {
  const params = new Set<Node>(fn.getParameters());
  const exprs = [raw.urlExpr, raw.baseUrlExpr, raw.methodExpr, raw.bodyExpr, raw.optionsExpr, raw.queryExpr, ...(raw.sdk ? requestArgs(raw.sdk) : [])].filter((e): e is Expression => !!e);
  return exprs.some((e) => referencesParam(e, params, 0));
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
  bodies: Map<Node, DetectResult>;
  direct: Map<Node, RawCall[]>;
  nested: Map<Node, Expansion[]>;
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
    found = detectFile(fn.getSourceFile(), registry, fn.getBody?.() ?? fn);
    caches.bodies.set(fn, found);
  }
  return found;
}

/** HTTP calls in the wrapper's body that its parameters flow into. */
function directCalls(fn: FunctionLike, registry: Registry, caches: Caches): RawCall[] {
  let direct = caches.direct.get(fn);
  if (!direct) {
    direct = bodyOf(fn, registry, caches)
      .calls.filter((c) => !c.via && paramsFlowInto(fn, c))
      .slice(0, MAX_INNER);
    caches.direct.set(fn, direct);
  }
  return direct;
}

/** Wrappers that `fn` calls with its own parameters (`tlsFetch(url)` -> `doFetch(url, init)`), each with the call. */
function innerWrappers(fn: FunctionLike, registry: Registry, caches: Caches): { call: CallExpression; g: FunctionLike; shift: number }[] {
  const params = new Set<Node>(fn.getParameters());
  return bodyOf(fn, registry, caches).candidates.flatMap((c) => {
    const g = wrapperFunction(c.callee);
    const flows = c.node.getArguments().some((a) => referencesParam(a, params, 0));
    return g && g !== fn && flows ? [{ call: c.node, g, shift: callShift(c.callee) }] : [];
  });
}

/** Second hop: when `fn` has no HTTP call of its own, the calls of the wrappers it calls, substituted at that inner call. */
function nestedCalls(fn: FunctionLike, registry: Registry, caches: Caches): Expansion[] {
  let nested = caches.nested.get(fn);
  if (!nested) {
    caches.nested.set(fn, []);
    nested = innerWrappers(fn, registry, caches)
      .flatMap(({ call, g, shift }) => directCalls(g, registry, caches).map((raw) => ({ raw, subst: substitutionFor(g, call, shift), via: [wrapperName(g)] })))
      .slice(0, MAX_INNER);
    caches.nested.set(fn, nested);
  }
  return nested;
}

function expansionsOf(fn: FunctionLike, registry: Registry, caches: Caches): Expansion[] {
  const direct = directCalls(fn, registry, caches);
  if (direct.length > 0) return direct.map((raw) => ({ raw, subst: new Map(), via: [] }));
  return nestedCalls(fn, registry, caches);
}

/** A wrapper three or more hops away from its HTTP call: named so the call site can be listed as not followed. */
function deeperWrapper(fn: FunctionLike, registry: Registry, caches: Caches): string | undefined {
  const hit = innerWrappers(fn, registry, caches).find(({ g }) => directCalls(g, registry, caches).length === 0 && nestedCalls(g, registry, caches).length > 0);
  return hit ? wrapperName(hit.g) : undefined;
}

/**
 * Expands wrappers at their call sites, up to two hops (`latest()` -> `tlsFetch(url)` -> `doFetch(url)` -> `fetch`):
 * calls to local functions whose body makes an HTTP call, or calls a wrapper that does, with their parameters. Deeper
 * chains come back as `wrapper-depth`.
 */
export function expandWrappers(candidates: WrapperCandidate[], registry: Registry): { calls: RawCall[]; unfollowed: Unfollowed[] } {
  const caches: Caches = { bodies: new Map(), direct: new Map(), nested: new Map() };
  const out: RawCall[] = [];
  const unfollowed: Unfollowed[] = [];
  for (const cand of candidates) {
    const fn = wrapperFunction(cand.callee);
    if (!fn) continue;
    const expansions = expansionsOf(fn, registry, caches);
    if (expansions.length === 0) {
      const via = deeperWrapper(fn, registry, caches);
      if (via) unfollowed.push({ node: cand.node, reason: "wrapper-depth", via });
      continue;
    }
    const outer = substitutionFor(fn, cand.node, callShift(cand.callee));
    for (const e of expansions) {
      const subst: Subst = new Map([...e.subst, ...outer]);
      const redetected = detectNode(e.raw.node, registry, { subst }).raw ?? e.raw;
      out.push({ ...redetected, node: cand.node, via: `wrapper:${[wrapperName(fn), ...e.via].join(">")}`, subst });
    }
  }
  return { calls: out, unfollowed };
}
