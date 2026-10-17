import { Node, VariableDeclarationKind, type CallExpression, type Expression, type Identifier } from "ts-morph";
import { isNothing, unwrap } from "../ast/expr.js";
import { isFunctionLike, returnsOf, type FunctionLike } from "../ast/function.js";
import { getProp, propertyKey, toObjectLiteral } from "../ast/object.js";
import { identifierOrigin } from "../ast/origin.js";
import { memoized, reactHook } from "../ast/react.js";
import type { Callee, Subst } from "../types.js";
import { hookValues } from "./held.js";

/**
 * The function a value is, when the code says which (#3, #4): `const { fetchWithAuth } = useApi()` where the app's hook
 * returns `{ fetchWithAuth }` made by `useCallback(async (url, init) => fetch(url, ...))`, `api.get(path)` on an object
 * literal or a factory's result, `const send = makeSender(base)` where `makeSender` returns an arrow. A function made by
 * a factory reads the factory's parameters as its call passes them (`closure`). The global `fetch` is `"fetch"`. Several
 * candidates (a factory returning one of two functions) are none: facts only.
 */
export type FnValue = { fn: FunctionLike; closure?: Subst } | "fetch";

const MAX_DEPTH = 16;
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self"]);

/**
 * A call whose callee the chain does not name, of a function the code still pins down: a function a hook or factory
 * returns, a method of an object literal, `globalThis.fetch` kept in a constant. `describeCallee` asks when the chain
 * names no wrapper.
 */
export function functionCallee(expr: Expression, c: Callee): Callee | undefined {
  // a global named through a factory's nested return (`return fetch(url)` inside the arrow it returns) is no client
  if (c.package || (c.global && !c.instance) || c.thisRoot) return undefined;
  if (c.localDecl && (Node.isClassDeclaration(c.localDecl) || Node.isClassExpression(c.localDecl))) return undefined;
  const u = unwrap(expr);
  if (!Node.isIdentifier(u) && !Node.isPropertyAccessExpression(u)) return undefined;
  const v = functionValue(u);
  if (!v) return undefined;
  return v === "fetch" ? { global: "fetch", chain: [] } : { localDecl: v.fn, chain: [], closure: v.closure };
}

export function functionValue(expr: Expression, depth = 0): FnValue | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const u = unwrap(expr);
  if (isFunctionLike(u)) return { fn: u };
  if (Node.isIdentifier(u)) return identifierValue(u, depth);
  if (Node.isPropertyAccessExpression(u)) return memberValue(u.getExpression(), u.getName(), depth);
  if (Node.isCallExpression(u)) return callValue(u, depth);
  return undefined;
}

/** The identifier a declaration is named by, to trace a shorthand property (`{ fetchImpl }`) to what it holds. */
function nameOfDecl(decl: Node | undefined): Identifier | undefined {
  if (!decl) return undefined;
  const name = Node.isImportSpecifier(decl) ? (decl.getAliasNode() ?? decl.getNameNode()) : (decl as { getNameNode?: () => Node }).getNameNode?.();
  return name && Node.isIdentifier(name) ? name : undefined;
}

function identifierValue(id: Identifier, depth: number): FnValue | undefined {
  const parent = id.getParent();
  if (Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === id) {
    const named = nameOfDecl(parent.getValueSymbol()?.getDeclarations()[0]);
    if (!named) return !parent.getValueSymbol() && id.getText() === "fetch" ? "fetch" : undefined;
    return named === id ? undefined : identifierValue(named, depth + 1);
  }
  if (!id.getSymbol()) return id.getText() === "fetch" ? "fetch" : undefined;
  const origin = identifierOrigin(id);
  if (origin.kind === "global") return origin.name === "fetch" ? "fetch" : undefined;
  return origin.kind === "local" ? declValue(origin.decl, depth) : undefined;
}

function declValue(decl: Node, depth: number): FnValue | undefined {
  if (isFunctionLike(decl)) return { fn: decl };
  if (Node.isVariableDeclaration(decl)) {
    // a `let` may be given another function later
    const init = decl.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const ? decl.getInitializer() : undefined;
    return init ? functionValue(init, depth + 1) : undefined;
  }
  if (!Node.isBindingElement(decl) || decl.getDotDotDotToken()) return undefined;
  const pattern = decl.getParent();
  const owner = pattern.getParent();
  if (!Node.isObjectBindingPattern(pattern) || !Node.isVariableDeclaration(owner)) return undefined;
  const init = owner.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const ? owner.getInitializer() : undefined;
  return init ? memberValue(init, decl.getPropertyNameNode()?.getText() ?? decl.getName(), depth + 1) : undefined;
}

/** The `name` member of what `obj` is: an object literal's, the object a factory or a hook returns, `globalThis.fetch`. */
function memberValue(obj: Expression, name: string, depth: number): FnValue | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const u = unwrap(obj);
  if (Node.isIdentifier(u) && name === "fetch" && GLOBAL_OBJECTS.has(u.getText())) {
    const origin = identifierOrigin(u);
    if (origin.kind === "global" || (origin.kind === "unknown" && !u.getSymbol())) return "fetch";
  }
  const lit = toObjectLiteral(u);
  if (lit) {
    const method = [...lit.getProperties()].reverse().find((m) => propertyKey(m) === name);
    if (method && Node.isMethodDeclaration(method)) return { fn: method };
    const value = getProp(lit, name);
    return value ? functionValue(value, depth + 1) : undefined;
  }
  const call = Node.isCallExpression(u) ? u : constInitCall(u);
  return call ? returnedMember(call, name, depth + 1) : undefined;
}

/** `const api = createApi(base)`: the call a constant is initialized with. */
function constInitCall(u: Expression): CallExpression | undefined {
  if (!Node.isIdentifier(u)) return undefined;
  const origin = identifierOrigin(u);
  const decl = origin.kind === "local" ? origin.decl : undefined;
  if (!decl || !Node.isVariableDeclaration(decl) || decl.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) return undefined;
  const init = decl.getInitializer();
  const call = init ? unwrap(init) : undefined;
  return call && Node.isCallExpression(call) ? call : undefined;
}

/** `useCallback(fn, deps)`, `useMemo(() => fn, deps)`, `fn.bind(x)`, and a factory's call: the function each hands out. */
function callValue(call: CallExpression, depth: number): FnValue | undefined {
  const callee = unwrap(call.getExpression());
  if (/(?:^|\.)useCallback$/.test(callee.getText()) && reactHook(call) === "useCallback") {
    const fn = call.getArguments()[0];
    return fn && Node.isExpression(fn) ? functionValue(fn, depth + 1) : undefined;
  }
  const memo = memoized(call);
  if (memo) return memo.length === 1 ? functionValue(memo[0]!, depth + 1) : undefined;
  if (Node.isPropertyAccessExpression(callee) && callee.getName() === "bind") return functionValue(callee.getExpression(), depth + 1);
  return returnedValue(call, (r) => functionValue(r, depth + 1));
}

/** The `name` member of the objects a hook hands out or a local function returns. */
function returnedMember(call: CallExpression, name: string, depth: number): FnValue | undefined {
  const hooked = hookValues(call);
  if (hooked) return agreed(hooked.map((v) => memberValue(v, name, depth + 1)));
  return returnedValue(call, (r) => memberValue(r, name, depth + 1));
}

/** What the function a call runs returns, read by `read`, with the call's arguments for the function's parameters. */
function returnedValue(call: CallExpression, read: (r: Expression) => FnValue | undefined): FnValue | undefined {
  const target = functionValue(call.getExpression(), MAX_DEPTH - 1);
  if (!target || target === "fetch") return undefined;
  const returned = returnsOf(target.fn).filter((r) => !isNothing(unwrap(r)));
  const found = agreed(returned.map(read));
  if (!found || found === "fetch") return found;
  const closure: Subst = new Map(found.closure);
  const args = call.getArguments();
  target.fn.getParameters().forEach((p, i) => {
    const arg = args[i] ?? p.getInitializer();
    if (arg && Node.isExpression(arg) && !p.isRestParameter() && !closure.has(p)) closure.set(p, arg);
  });
  return { fn: found.fn, closure };
}

/** The one value every candidate is; none when one is unknown or two differ. */
function agreed(values: (FnValue | undefined)[]): FnValue | undefined {
  const first = values[0];
  if (!first) return undefined;
  const same = (v: FnValue | undefined): boolean => !!v && (v === "fetch" ? first === "fetch" : first !== "fetch" && v.fn === first.fn);
  return values.every(same) ? first : undefined;
}
