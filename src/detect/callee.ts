import { Node, SyntaxKind, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import type { Callee } from "../types.js";
import { identifierOrigin, packageFromFilePath } from "./origin.js";
import { annotatedPackage } from "./type-annotation.js";

const MAX_DEPTH = 6;

/** Strips parentheses, casts, non-null assertions and awaits. */
export function unwrap(e: Expression): Expression {
  let cur = e;
  for (;;) {
    if (Node.isParenthesizedExpression(cur) || Node.isAsExpression(cur) || Node.isNonNullExpression(cur)) cur = cur.getExpression();
    else if (Node.isSatisfiesExpression(cur) || Node.isTypeAssertion(cur) || Node.isAwaitExpression(cur)) cur = cur.getExpression();
    else return cur;
  }
}

export interface Chain {
  root: Expression;
  /** nodes[i] is the expression covering root + chain[0..i-1]. */
  nodes: Expression[];
  chain: string[];
}

/** `a.b.c` -> root `a`, chain ["b", "c"]; supports `a["b"]`. */
export function memberChain(expr: Expression): Chain {
  const names: string[] = [];
  const nodes: Expression[] = [];
  let cur = unwrap(expr);
  for (;;) {
    if (Node.isPropertyAccessExpression(cur)) {
      names.unshift(cur.getName());
      nodes.unshift(cur);
      cur = unwrap(cur.getExpression());
    } else if (Node.isElementAccessExpression(cur) && Node.isStringLiteral(cur.getArgumentExpression())) {
      names.unshift((cur.getArgumentExpression() as Expression & { getLiteralValue(): string }).getLiteralValue());
      nodes.unshift(cur);
      cur = unwrap(cur.getExpression());
    } else break;
  }
  nodes.unshift(cur);
  return { root: cur, nodes, chain: names };
}

/** Chain as seen from the package's exports: named import name is prepended, default/namespace are not. */
export function exportedChain(c: Callee): string[] {
  const n = c.importedName;
  if (!n || n === "default" || n === "*") return c.chain;
  return [n, ...c.chain];
}

export function describeCallee(call: CallExpression | NewExpression, depth = 0): Callee {
  const expr = call.getExpression();
  const mc = memberChain(expr as Expression);
  return calleeFromChain(mc, depth);
}

function calleeFromChain(mc: Chain, depth: number): Callee {
  if (depth > MAX_DEPTH) return { chain: mc.chain };
  const { root, chain } = mc;
  if (Node.isIdentifier(root)) {
    const o = identifierOrigin(root);
    if (o.kind === "package") return { package: o.package, importedName: o.importedName, chain };
    if (o.kind === "global") return { global: o.name, chain };
    if (o.kind === "local") return localCallee(o.decl, mc, depth);
    return typeFallback(mc, 0);
  }
  if (Node.isThisExpression(root)) return thisCallee(mc, depth);
  if (Node.isCallExpression(root) || Node.isNewExpression(root)) return instanceCallee(root, chain, depth);
  return typeFallback(mc, 0);
}

/** `const api = createClient()` where the local factory returns `axios.create(...)` / `new Stripe(...)`. */
function factoryReturn(inner: Callee, depth: number): Callee | undefined {
  const fn = inner.localDecl;
  if (!fn || inner.chain.length > 0 || depth > MAX_DEPTH) return undefined;
  if (!Node.isFunctionDeclaration(fn) && !Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn) && !Node.isMethodDeclaration(fn)) return undefined;
  const body = fn.getBody();
  const returned = body && Node.isExpression(body) ? [body] : body?.getDescendantsOfKind(SyntaxKind.ReturnStatement).map((r) => r.getExpression()) ?? [];
  for (const expr of returned) {
    let u = expr ? unwrap(expr) : undefined;
    if (u && Node.isIdentifier(u)) {
      const decl = u.getSymbol()?.getDeclarations()[0];
      const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
      u = init ? unwrap(init) : undefined;
    }
    if (u && (Node.isCallExpression(u) || Node.isNewExpression(u))) {
      const c = describeCallee(u, depth + 1);
      if (c.package || c.global) return { ...c, instance: { kind: Node.isNewExpression(u) ? "new" : "call", chain: exportedChain(c), args: u.getArguments() as Expression[] } };
    }
  }
  return undefined;
}

function instanceCallee(init: CallExpression | NewExpression, chain: string[], depth: number): Callee {
  const inner = describeCallee(init, depth + 1);
  const viaFactory = factoryReturn(inner, depth);
  if (viaFactory) return { ...viaFactory, chain };
  return {
    package: inner.package,
    importedName: inner.importedName,
    global: inner.global,
    localDecl: inner.localDecl,
    viaType: inner.viaType,
    instance: {
      kind: Node.isNewExpression(init) ? "new" : "call",
      chain: exportedChain(inner),
      args: init.getArguments() as Expression[],
    },
    rootInstance: inner.rootInstance ?? inner.instance,
    chain,
  };
}

/** Initializer of a local; a parameter's default (`fetchImpl = fetch`) counts, since it is what runs unless overridden. */
function initializerOf(decl: Node): Expression | undefined {
  if (Node.isVariableDeclaration(decl) || Node.isPropertyDeclaration(decl) || Node.isBindingElement(decl) || Node.isParameterDeclaration(decl)) {
    return decl.getInitializer();
  }
  if (Node.isPropertyAssignment(decl)) return decl.getInitializer();
  return undefined;
}

function localCallee(decl: Node, mc: Chain, depth: number): Callee {
  const { chain } = mc;
  if (Node.isFunctionDeclaration(decl) || Node.isMethodDeclaration(decl) || Node.isClassDeclaration(decl)) {
    return { localDecl: decl, chain };
  }
  const init = initializerOf(decl);
  if (init) {
    const u = unwrap(init);
    if (Node.isArrowFunction(u) || Node.isFunctionExpression(u)) return { localDecl: u, chain };
    if (Node.isCallExpression(u) || Node.isNewExpression(u)) return instanceCallee(u, chain, depth);
    if (Node.isIdentifier(u) || Node.isPropertyAccessExpression(u)) {
      const inner = memberChain(u);
      const merged: Chain = { root: inner.root, nodes: [...inner.nodes, ...mc.nodes.slice(1)], chain: [...inner.chain, ...chain] };
      const c = calleeFromChain(merged, depth + 1);
      return c.viaType ? typeFallback(mc, 0) : c;
    }
  }
  return typeFallback(mc, 0, decl);
}

function thisCallee(mc: Chain, depth: number): Callee {
  const { root, chain } = mc;
  const cls = root.getFirstAncestorByKind(SyntaxKind.ClassDeclaration) ?? root.getFirstAncestorByKind(SyntaxKind.ClassExpression);
  const propName = chain[0];
  if (!cls || !propName) return { ...typeFallback(mc, 1), thisRoot: true };
  const prop = cls.getProperty(propName);
  const method = cls.getMethod(propName);
  if (method) return { localDecl: method, chain: chain.slice(1) };
  const rest: Chain = { root: mc.nodes[1] ?? root, nodes: mc.nodes.slice(1), chain: chain.slice(1) };
  if (prop?.getInitializer()) return localCallee(prop, rest, depth + 1);
  const paramProp = cls.getConstructors().flatMap((c) => c.getParameters()).find((p) => p.getName() === propName && p.isParameterProperty());
  if (paramProp?.getInitializer()) return localCallee(paramProp, rest, depth + 1);
  const assigned = constructorAssignment(cls, propName);
  if (assigned) {
    const u = unwrap(assigned);
    if (Node.isCallExpression(u) || Node.isNewExpression(u)) return instanceCallee(u, rest.chain, depth + 1);
  }
  return { ...typeFallback(mc, 1), thisRoot: true };
}

/** Initializer of `this.<prop>`: property initializer or `this.prop = ...` in the constructor. */
export function classPropertyInitializer(at: Node, propName: string): Expression | undefined {
  const cls = at.getFirstAncestorByKind(SyntaxKind.ClassDeclaration) ?? at.getFirstAncestorByKind(SyntaxKind.ClassExpression);
  if (!cls) return undefined;
  const prop = cls.getProperty(propName);
  const init = prop?.getInitializer();
  if (init) return init;
  const param = cls.getConstructors().flatMap((c) => c.getParameters()).find((p) => p.getName() === propName && p.getScope() !== undefined && p.isParameterProperty());
  if (param) return undefined;
  return constructorAssignment(cls, propName);
}

function constructorAssignment(cls: Node, propName: string): Expression | undefined {
  if (!Node.isClassDeclaration(cls) && !Node.isClassExpression(cls)) return undefined;
  for (const ctor of cls.getConstructors()) {
    for (const bin of ctor.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const left = bin.getLeft();
      if (bin.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
      if (Node.isPropertyAccessExpression(left) && Node.isThisExpression(left.getExpression()) && left.getName() === propName) {
        return bin.getRight();
      }
    }
  }
  return undefined;
}

export function packageOfType(t: import("ts-morph").Type): string | undefined {
  const sym = t.getSymbol() ?? t.getAliasSymbol();
  if (!sym) return undefined;
  for (const d of sym.getDeclarations()) {
    const pkg = packageFromFilePath(d.getSourceFile().getFilePath());
    if (pkg) return pkg;
  }
  return undefined;
}

/**
 * Walks chain prefixes and returns the first whose static type is declared in a node_modules package; when the
 * package's types are not installed, the written annotation (`db: SupabaseClient`) is traced to its import instead.
 */
function typeFallback(mc: Chain, startIndex: number, decl?: Node): Callee {
  const nodes = mc.nodes;
  for (let i = startIndex; i < nodes.length; i++) {
    const node = nodes[i]!;
    const pkg = packageOfType(node.getType());
    if (pkg) return { package: pkg, chain: mc.chain.slice(i), viaType: true };
  }
  if (decl && (Node.isParameterDeclaration(decl) || Node.isPropertyDeclaration(decl) || Node.isVariableDeclaration(decl))) {
    const pkg = packageOfType(decl.getType());
    if (pkg) return { package: pkg, chain: mc.chain, viaType: true };
  }
  for (let i = startIndex; i < nodes.length; i++) {
    const pkg = annotatedPackage(nodes[i]!);
    if (pkg) return { package: pkg, chain: mc.chain.slice(i), viaType: true };
  }
  return { chain: mc.chain, localDecl: decl && Node.isParameterDeclaration(decl) ? undefined : decl };
}
