import { Node, SyntaxKind, type CallExpression, type ClassDeclaration, type Expression } from "ts-morph";
import { constructorAssignment, enclosingClass, fieldAssignments, parameterProperty } from "../ast/class.js";
import { unwrap } from "../ast/expr.js";
import { isFunctionLike, type FunctionLike } from "../ast/function.js";
import { declarationOf } from "./client-cache.js";

/**
 * Functions injected into a class (#98): `constructor(private readonly getProvider: (chainId: number) => Provider)`,
 * then `this.getProvider(chainId)`. What the call returns is what the functions the class's `new` expressions pass
 * return (`new TokenService(getProvider)`): the app's own helper, often one that fills a cache. All of them, or none
 * when one caller passes something the scan cannot read.
 */

/** Callers and distinct functions looked at per class and parameter: bounds on hostile input. */
const MAX_CALLERS = 50;
const MAX_FUNCTIONS = 8;

/** The function an argument names: a function declared or assigned to a variable (also imported), or written in place. */
function functionOf(arg: Expression): FunctionLike | undefined {
  const u = unwrap(arg);
  if (isFunctionLike(u)) return u;
  const decl = Node.isIdentifier(u) ? declarationOf(u) : undefined;
  const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
  const fn = init ? unwrap(init) : decl;
  return isFunctionLike(fn) ? fn : undefined;
}

/** The constructor parameter a field holds, when the constructor keeps it there and nothing else sets it. */
function injectedParam(cls: ClassDeclaration, field: string): number | undefined {
  if (cls.getMethod(field) || cls.getProperty(field)?.getInitializer()) return undefined;
  const ctor = cls.getConstructors()[0];
  const prop = parameterProperty(cls, field);
  const assigned = prop ? undefined : constructorAssignment(cls, field);
  const ident = assigned ? unwrap(assigned) : undefined;
  const param = prop ?? (ident && Node.isIdentifier(ident) ? declarationOf(ident) : undefined);
  if (!ctor || !param || !Node.isParameterDeclaration(param) || param.getParent() !== ctor || param.getInitializer()) return undefined;
  return fieldAssignments(cls, field).length === (prop ? 0 : 1) ? ctor.getParameters().indexOf(param) : undefined;
}

/** The `new` expressions of a class across the project, found by its name first. */
function constructionsOf(cls: ClassDeclaration): Node[] {
  const name = cls.getName();
  if (!name) return [];
  const out: Node[] = [];
  for (const sf of cls.getProject().getSourceFiles()) {
    if (sf.isDeclarationFile() || sf.isFromExternalLibrary() || !sf.getFullText().includes(`new ${name}`)) continue;
    for (const n of sf.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      const e = unwrap(n.getExpression());
      if (Node.isIdentifier(e) && e.getText() === name && declarationOf(e) === cls) out.push(n);
      if (out.length > MAX_CALLERS) return [];
    }
  }
  return out;
}

const known = new WeakMap<ClassDeclaration, Map<string, FunctionLike[] | null>>();

function functionsPassed(cls: ClassDeclaration, field: string): FunctionLike[] | null {
  let byField = known.get(cls);
  if (!byField) known.set(cls, (byField = new Map<string, FunctionLike[] | null>()));
  const hit = byField.get(field);
  if (hit !== undefined) return hit;
  const index = injectedParam(cls, field);
  let out: FunctionLike[] | null = index === undefined ? null : [];
  for (const n of index === undefined ? [] : constructionsOf(cls)) {
    const arg = Node.isNewExpression(n) ? n.getArguments()[index!] : undefined;
    const fn = arg && Node.isExpression(arg) ? functionOf(arg) : undefined;
    if (!fn || out!.length >= MAX_FUNCTIONS) {
      out = null;
      break;
    }
    if (!out!.includes(fn)) out!.push(fn);
  }
  const found = out && out.length > 0 ? out : null;
  byField.set(field, found);
  return found;
}

/** `this.getProvider(chainId)`: the functions the constructor is handed for that field; undefined for any other call. */
export function injectedFunctions(call: CallExpression): FunctionLike[] | undefined {
  const callee = unwrap(call.getExpression());
  if (!Node.isPropertyAccessExpression(callee) || !Node.isThisExpression(callee.getExpression())) return undefined;
  const cls = enclosingClass(call);
  if (!cls || !Node.isClassDeclaration(cls)) return undefined;
  return functionsPassed(cls, callee.getName()) ?? undefined;
}
