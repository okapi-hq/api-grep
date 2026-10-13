import { Node, SyntaxKind, type CallExpression, type NewExpression, type ParameterDeclaration, type SourceFile } from "ts-morph";
import { constructorAssignment, enclosingClass, fieldAssignments, parameterProperty } from "../ast/class.js";
import { memberChain, unwrap, type Chain } from "../ast/expr.js";
import { isFunctionLike, type FunctionLike } from "../ast/function.js";
import { evaluate } from "../resolve/evaluate.js";
import type { Callee, RawCall, RegistryEntry, Subst } from "../types.js";
import { callShift, calleeThrough, describeCallee, wrapperFunction } from "./callee.js";
import type { Registry } from "./registry/index.js";
import { detectSdk } from "./sdk.js";

/** Callers looked at per function, and distinct clients reported per call: bounds on hostile input. */
const MAX_CALLERS = 50;
const MAX_CLIENTS = 4;

/** An SDK method called on an untyped parameter: `c.chat.completions.create(...)` with `c: any`. */
export interface Receiver {
  param: ParameterDeclaration;
  fn: FunctionLike;
  /** The callee's member chain, rooted at the parameter. */
  mc: Chain;
  key: string;
  /** The client is a field the constructor sets from the parameter (`this.client = client`): `mc` is rooted at the field. */
  field?: boolean;
}

export interface ReceiverResult {
  raws: RawCall[];
  /** No caller passes a known client and the manifests name no single SDK with the method. */
  unknown: boolean;
}

const UNTYPED = new Set(["any", "unknown"]);

const untyped = (param: ParameterDeclaration): boolean => {
  const type = param.getTypeNode();
  return !type || UNTYPED.has(type.getText());
};

const hasMethod = (registry: Registry, key: string): boolean => registry.entries().some((e) => !!e.methods && Object.hasOwn(e.methods, key));

/**
 * `this.client.graphql(q)` where the constructor keeps an untyped parameter in the field (`this.client = client`, or a
 * parameter property): the receiver is that parameter, whatever `new` passes for it. The field is set nowhere else.
 */
function fieldReceiver(mc: Chain, registry: Registry): Receiver | undefined {
  const cls = enclosingClass(mc.root);
  const field = mc.chain[0]!;
  if (!cls || cls.getProperty(field)?.getInitializer()) return undefined;
  const prop = parameterProperty(cls, field);
  const assigned = fieldAssignments(cls, field);
  const value = prop ? undefined : constructorAssignment(cls, field);
  const ident = value && assigned.length === 1 ? unwrap(value) : undefined;
  const param = prop && assigned.length === 0 ? prop : ident && Node.isIdentifier(ident) ? ident.getSymbol()?.getDeclarations()[0] : undefined;
  if (!param || !Node.isParameterDeclaration(param) || param.getInitializer() || !untyped(param)) return undefined;
  const ctor = param.getParent();
  if (!Node.isConstructorDeclaration(ctor) || ctor.getParent() !== cls) return undefined;
  const rest: Chain = { root: mc.nodes[1]!, nodes: mc.nodes.slice(1), chain: mc.chain.slice(1) };
  const key = rest.chain.join(".");
  return hasMethod(registry, key) ? { param, fn: ctor, mc: rest, key, field: true } : undefined;
}

/**
 * The receiver of a call the detectors did not recognize, when it is a parameter without a usable type and the chain
 * after it is a registry method of two members or more (one member, `http.get(url)`, is an HTTP client's verb).
 */
export function receiverOf(node: CallExpression, callee: Callee, registry: Registry): Receiver | undefined {
  if (callee.package || callee.global || callee.localDecl || callee.chain.length < 2) return undefined;
  const mc = memberChain(node.getExpression());
  if (Node.isThisExpression(mc.root)) return fieldReceiver(mc, registry);
  if (!Node.isIdentifier(mc.root)) return undefined;
  const param = mc.root.getSymbol()?.getDeclarations()[0];
  if (!param || !Node.isParameterDeclaration(param) || param.getInitializer() || !untyped(param)) return undefined;
  const fn = param.getParent();
  if (!isFunctionLike(fn)) return undefined;
  const key = mc.chain.join(".");
  return hasMethod(registry, key) ? { param, fn, mc, key } : undefined;
}

/** In a wrapper expansion, the receiver is what the caller passed for the parameter. */
export function substitutedReceiver(node: CallExpression, callee: Callee, registry: Registry, subst: Subst): RawCall | null {
  const r = receiverOf(node, callee, registry);
  const arg = r ? subst.get(r.param) : undefined;
  return r && arg ? detectSdk(node, calleeThrough(arg, r.mc), registry) : null;
}

/** The name callers use: a function's or method's own, the variable or property an arrow function is assigned to. */
function nameOf(fn: FunctionLike): string | undefined {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) return fn.getName();
  const parent = fn.getParent();
  return parent && (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent)) ? parent.getName() : undefined;
}

/** The name a call or `new` uses; constructions are indexed apart (`new Client(x)` does not call a `Client` function). */
function calledName(call: CallExpression | NewExpression): string | undefined {
  const e = unwrap(call.getExpression());
  const name = Node.isIdentifier(e) ? e.getText() : Node.isPropertyAccessExpression(e) ? e.getName() : undefined;
  return name && Node.isNewExpression(call) ? `new ${name}` : name;
}

/** The class a constructor builds, by the name `new` uses. */
function classNameOf(fn: FunctionLike): string | undefined {
  const cls = Node.isConstructorDeclaration(fn) ? fn.getParent() : undefined;
  return cls && Node.isClassDeclaration(cls) ? cls.getName() : undefined;
}

/**
 * Follows SDK calls made on untyped parameters: the clients the function's callers in the scanned files pass, one level
 * up; else the one SDK the manifests next to the file declare with that method; else unknown. Results are per call.
 */
export class ReceiverResolver {
  private index?: Map<string, (CallExpression | NewExpression)[]>;
  private readonly results = new Map<Node, ReceiverResult>();

  /**
   * `groupOf` gives the group of files that can see each other (`lang/typescript/graph.ts`): a call in another group
   * cannot reach the function, so only those of its group are counted against `MAX_CALLERS`.
   */
  constructor(
    private readonly files: SourceFile[],
    readonly registry: Registry,
    private readonly declared: (file: string) => Set<string>,
    private readonly groupOf?: (file: string) => number | undefined,
  ) {}

  resolve(node: CallExpression, r: Receiver): ReceiverResult {
    let out = this.results.get(node);
    if (!out) {
      const raws = this.fromCallers(node, r);
      // a field's one-member method (`this.client.graphql`) is too common a name to stand for an SDK by itself
      const guess = !r.field || r.mc.chain.length >= 2;
      const manifest = raws.length === 0 && guess ? this.fromManifest(node, r) : undefined;
      out = { raws: manifest ? [manifest] : raws, unknown: raws.length === 0 && !manifest && guess };
      this.results.set(node, out);
    }
    return out;
  }

  /** Calls by name across the scanned files, indexed once. */
  private callsNamed(name: string): (CallExpression | NewExpression)[] {
    if (!this.index) {
      this.index = new Map();
      for (const sf of this.files) {
        for (const call of [...sf.getDescendantsOfKind(SyntaxKind.CallExpression), ...sf.getDescendantsOfKind(SyntaxKind.NewExpression)]) {
          const n = calledName(call);
          const list = n ? this.index.get(n) : undefined;
          if (list) list.push(call);
          else if (n) this.index.set(n, [call]);
        }
      }
    }
    return this.index.get(name) ?? [];
  }

  private fromCallers(node: CallExpression, r: Receiver): RawCall[] {
    const cls = classNameOf(r.fn);
    const name = cls ? `new ${cls}` : nameOf(r.fn);
    const position = r.fn
      .getParameters()
      .filter((p) => p.getName() !== "this")
      .indexOf(r.param);
    const out = new Map<string, RawCall>();
    const group = this.groupOf?.(node.getSourceFile().getFilePath());
    const reachable = (c: CallExpression | NewExpression): boolean => group === undefined || this.groupOf!(c.getSourceFile().getFilePath()) === group;
    for (const caller of (name ? this.callsNamed(name).filter(reachable) : []).slice(0, MAX_CALLERS)) {
      const callee = describeCallee(caller);
      const runs = cls ? callee.localDecl === r.fn.getParent() && callee.chain.length === 0 : wrapperFunction(callee) === r.fn;
      if (!runs) continue;
      const arg = caller.getArguments()[(cls ? 0 : callShift(callee)) + position];
      if (!arg || !Node.isExpression(arg)) continue;
      const raw = detectSdk(node, calleeThrough(arg, r.mc), this.registry);
      if (!raw?.sdk) continue;
      const key = `${raw.sdk.package}|${raw.baseUrlExpr ? JSON.stringify(evaluate(raw.baseUrlExpr)) : ""}`;
      if (!out.has(key)) out.set(key, { ...raw, subst: new Map([[r.param, arg]]), clientFrom: "caller" });
      if (out.size >= MAX_CLIENTS) break;
    }
    return [...out.values()];
  }

  /** The one declared package whose registry has the method. */
  private fromManifest(node: CallExpression, r: Receiver): RawCall | undefined {
    const declared = this.declared(node.getSourceFile().getFilePath());
    const has = (e: RegistryEntry): boolean => !!e.methods && Object.hasOwn(e.methods, r.key);
    const matches = this.registry.entries().filter((e) => has(e) && [e.package, ...(e.aliases ?? [])].some((p) => declared.has(p)));
    if (matches.length !== 1) return undefined;
    const raw = detectSdk(node, { package: matches[0]!.package, chain: r.mc.chain, viaType: true }, this.registry);
    return raw ? { ...raw, clientFrom: "manifest" } : undefined;
  }
}
