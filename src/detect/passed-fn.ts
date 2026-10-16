import { Node, VariableDeclarationKind, type CallExpression, type Expression, type ParameterDeclaration } from "ts-morph";
import { constructorAssignment, enclosingClass, fieldAssignments, parameterProperty } from "../ast/class.js";
import { memberChain, unwrap } from "../ast/expr.js";
import { isFunctionLike, type FunctionLike } from "../ast/function.js";
import { declarationsOf, getProp, toObjectLiteral } from "../ast/object.js";
import { functionValue, type FnValue } from "./fn-value.js";
import type { ReceiverResolver } from "./receiver.js";

/**
 * A function received from outside (#4: `injected-fetch`), followed through the callers one level up, as SDK clients
 * are (#37): `fetchImpl(url)`, `deps.fetchUpstream(url)`, `{ supaFetch }` destructured from a parameter, and
 * `this.fetchFn(url)` where the constructor keeps a parameter, or a member of one, in the field. What every caller in the
 * scanned files passes (or the parameter's default, for a caller that passes nothing) must be one function, or the
 * global `fetch`; a caller passing something unreadable is not counted, and two that disagree leave the call unfollowed.
 */

/** A parameter of `fn` and the members read off it to reach the function called. */
interface ParamPath {
  fn: FunctionLike;
  param: ParameterDeclaration;
  path: string[];
  /** `const fetcher = opts.fetcher ?? defaultFetcher`: what runs when a caller passes none. */
  fallback?: Expression;
}

/** Distinct functions callers may pass before giving up: a bound on hostile input. */
const MAX_VALUES = 4;

function ownerOf(param: ParameterDeclaration): FunctionLike | undefined {
  const fn = param.getParent();
  return isFunctionLike(fn) || Node.isConstructorDeclaration(fn) ? fn : undefined;
}

/**
 * The parameter an identifier is, or the parameter whose object pattern it is destructured from (one level); a constant
 * it is given first (`const fetcher = opts.fetcher ?? defaultFetcher`) counts, once.
 */
function fromIdentifier(id: Node, rest: string[], hops = 0): ParamPath | undefined {
  for (const decl of declarationsOf(id as Expression)) {
    if (Node.isParameterDeclaration(decl)) {
      const fn = ownerOf(decl);
      return fn ? { fn, param: decl, path: rest } : undefined;
    }
    if (Node.isBindingElement(decl) && !decl.getDotDotDotToken()) {
      const param = decl.getParent().getParent();
      if (!Node.isParameterDeclaration(param) || !Node.isObjectBindingPattern(decl.getParent())) return undefined;
      const fn = ownerOf(param);
      return fn ? { fn, param, path: [decl.getPropertyNameNode()?.getText() ?? decl.getName(), ...rest] } : undefined;
    }
    const init = Node.isVariableDeclaration(decl) && decl.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const ? decl.getInitializer() : undefined;
    return init && hops === 0 && rest.length === 0 ? fromValue(init, 1) : undefined;
  }
  return undefined;
}

/** `opts.fetchFn`, `opts.fetchFn ?? fetch`: the parameter a value reads, with the fallback it has. */
function fromValue(value: Expression, hops: number): ParamPath | undefined {
  const u = unwrap(value);
  if (Node.isBinaryExpression(u) && ["??", "||"].includes(u.getOperatorToken().getText())) {
    const p = fromValue(u.getLeft(), hops);
    return p && !p.fallback ? { ...p, fallback: u.getRight() } : undefined;
  }
  const mc = memberChain(u);
  return Node.isIdentifier(mc.root) ? fromIdentifier(mc.root, mc.chain, hops) : undefined;
}

/** `this.fetchFn`, `this.deps.fetch`: the constructor parameter the field holds, set there and nowhere else. */
function fromField(chain: string[], at: Node): ParamPath | undefined {
  const cls = enclosingClass(at);
  const field = chain[0];
  if (!cls || !field || cls.getProperty(field)?.getInitializer()) return undefined;
  const prop = parameterProperty(cls, field);
  if (prop) return fieldAssignments(cls, field).length === 0 ? fromIdentifier(prop.getNameNode(), chain.slice(1)) : undefined;
  const value = constructorAssignment(cls, field);
  if (!value || fieldAssignments(cls, field).length !== 1) return undefined;
  if (chain.length === 1) return fromValue(value, 1);
  const mc = memberChain(value);
  return Node.isIdentifier(mc.root) ? fromIdentifier(mc.root, [...mc.chain, ...chain.slice(1)], 1) : undefined;
}

function paramPathOf(call: CallExpression): ParamPath | undefined {
  const mc = memberChain(call.getExpression());
  if (Node.isThisExpression(mc.root)) return fromField(mc.chain, call);
  return Node.isIdentifier(mc.root) ? fromIdentifier(mc.root, mc.chain) : undefined;
}

/** A parameter's default, also inside an object pattern (`{ fetchImpl = fetch } = {}`), when the call reads one. */
function defaultOf(arg: Expression): Expression | undefined {
  const u = unwrap(arg);
  const decl = Node.isIdentifier(u) ? declarationsOf(u)[0] : undefined;
  return decl && (Node.isParameterDeclaration(decl) || Node.isBindingElement(decl)) ? decl.getInitializer() : undefined;
}

/**
 * What a caller hands for the path: its argument's members, else the defaults of the patterns it falls back to, else
 * the fallback the callee gives. An argument that does not read as an object passes something unknown: no value.
 */
function passedValue(p: ParamPath, arg: Node | undefined): FnValue | undefined {
  let value: Expression | undefined = arg && Node.isExpression(arg) ? arg : p.param.getInitializer();
  let missing = !value;
  for (const key of p.path) {
    if (!value) break;
    if (!toObjectLiteral(value)) return undefined;
    value = getProp(value, key);
    missing = !value;
  }
  if (!value && p.path.length === 1) value = patternDefault(p.param, p.path[0]!);
  if (!value && missing && p.fallback) value = p.fallback;
  if (!value) return undefined;
  const found = functionValue(value);
  if (found) return found;
  const fallback = defaultOf(value);
  return fallback ? functionValue(fallback) : undefined;
}

function patternDefault(param: ParameterDeclaration, key: string): Expression | undefined {
  const pattern = param.getNameNode();
  if (!Node.isObjectBindingPattern(pattern)) return undefined;
  return pattern.getElements().find((e) => (e.getPropertyNameNode()?.getText() ?? e.getName()) === key)?.getInitializer();
}

/** The one function the callers of the enclosing function pass for the callee; undefined when it is not one. */
export function passedFunction(call: CallExpression, receivers: ReceiverResolver): FnValue | undefined {
  const p = paramPathOf(call);
  if (!p) return undefined;
  const found: FnValue[] = [];
  for (const { arg } of receivers.argumentsFor(p.fn, p.param)) {
    const v = passedValue(p, arg);
    if (!v) continue;
    if (!found.some((f) => sameValue(f, v))) found.push(v);
    if (found.length >= MAX_VALUES) break;
  }
  return found.length === 1 ? found[0] : undefined;
}

function sameValue(a: FnValue, b: FnValue): boolean {
  return a === "fetch" || b === "fetch" ? a === b : a.fn === b.fn;
}
