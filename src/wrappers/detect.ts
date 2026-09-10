import { Node, type CallExpression, type Expression } from "ts-morph";
import { detectFile, detectNode, type WrapperCandidate } from "../detect/index.js";
import { declarationsOf } from "../detect/options.js";
import type { Registry } from "../detect/registry/index.js";
import type { RawCall, Subst } from "../types.js";
import { wrapperFunction, type FunctionLike } from "./function.js";

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

function substitutionFor(fn: FunctionLike, call: CallExpression): Subst {
  const subst: Subst = new Map();
  const args = call.getArguments() as Expression[];
  fn.getParameters().forEach((p, i) => {
    const arg = args[i] ?? p.getInitializer();
    if (arg && !p.isRestParameter()) subst.set(p, arg);
  });
  return subst;
}

/** Expands one-hop wrappers: calls to local functions whose body contains a detected HTTP call. */
export function expandWrappers(candidates: WrapperCandidate[], registry: Registry): RawCall[] {
  const cache = new Map<Node, RawCall[]>();
  const out: RawCall[] = [];
  for (const cand of candidates) {
    const fn = wrapperFunction(cand.callee);
    if (!fn) continue;
    const body = fn.getBody?.() ?? fn;
    let inner = cache.get(fn);
    if (!inner) {
      inner = detectFile(fn.getSourceFile(), registry, body)
        .calls.filter((c) => !c.via && paramsFlowInto(fn, c))
        .slice(0, MAX_INNER);
      cache.set(fn, inner);
    }
    if (inner.length === 0) continue;
    const subst = substitutionFor(fn, cand.node);
    const via = `wrapper:${wrapperName(fn)}`;
    for (const raw of inner) {
      const redetected = detectNode(raw.node, registry, { subst }).raw ?? raw;
      out.push({ ...redetected, node: cand.node, via, subst });
    }
  }
  return out;
}
