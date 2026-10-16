import type { ClassDef, FunctionDef } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { isComment, lowerArgs, lowerNodes, lowerOther } from "./lower-expr.js";
import { declaredType, fieldParams, inFunction, lowerBody, lowerParams } from "./lower-stmt.js";
import { addField, newFunction, posOf, type DartState } from "./names.js";

/**
 * Classes, mixins, enums and extensions. The unnamed constructor is `<init>`: its `this.x` parameters, initializer list
 * and body set fields, and field initializers run there too. A named constructor (`Api.staging()`) or a factory is a
 * static method returning an instance; a getter is a method read as a property, and what it returns a field value
 * (`String get baseUrl => '$host/api'`).
 */

/** The declarations of a class body: each member's signature with the body that follows it. */
function members(body: SyntaxNode): { sig: SyntaxNode; body?: SyntaxNode }[] {
  const out: { sig: SyntaxNode; body?: SyntaxNode }[] = [];
  for (const c of named(body)) {
    if (c.type === "function_body" && out.length > 0 && !out.at(-1)!.body) out.at(-1)!.body = c;
    else if (c.type === "declaration" || c.type === "method_signature" || c.type === "enum_constant") out.push({ sig: c });
  }
  return out;
}

/** The variables a declaration list declares, with their initializers: `a = 1, b`, `static const x = '...'`. */
export function declarators(list: SyntaxNode): { name: SyntaxNode; value: SyntaxNode[] }[] {
  return named(list)
    .filter((d) => d.type === "initialized_identifier" || d.type === "static_final_declaration")
    .flatMap((d) => {
      const [name, ...value] = named(d).filter((c) => !isComment(c));
      return name ? [{ name, value }] : [];
    });
}

const SIGNATURES = new Set(["function_signature", "getter_signature", "setter_signature", "constructor_signature", "constant_constructor_signature", "factory_constructor_signature", "redirecting_factory_constructor_signature", "operator_signature"]);
const LISTS = new Set(["initialized_identifier_list", "static_final_declaration_list"]);

/** Names a bare identifier in the class can mean: fields, methods, getters and setters. */
function memberNames(body: SyntaxNode | undefined): Set<string> {
  const names = new Set<string>();
  for (const { sig } of body ? members(body) : []) {
    for (const c of named(sig)) {
      if (LISTS.has(c.type)) for (const d of declarators(c)) names.add(d.name.text);
      else if (c.type === "function_signature" || c.type === "getter_signature" || c.type === "setter_signature") names.add(field(c, "name")?.text ?? "");
    }
    if (sig.type === "enum_constant") names.add(field(sig, "name")?.text ?? "");
  }
  names.delete("");
  return names;
}

interface ClassCtx {
  cls: ClassDef;
  init: FunctionDef;
  /** Where members are lowered: the class's members in scope. */
  st: DartState;
}

/** A field declaration: its type, and its initializer, which runs in `<init>`. */
function lowerFields(sig: SyntaxNode, ctx: ClassCtx): void {
  const list = named(sig).find((c) => LISTS.has(c.type));
  if (!list) return;
  const type = declaredType(named(sig).filter((c) => c.endIndex <= list.startIndex));
  const st = inFunction(ctx.st, ctx.init, false);
  for (const d of declarators(list)) {
    if (type) ctx.cls.fieldTypes.set(d.name.text, type);
    if (d.value.length > 0) addField(ctx.cls, d.name.text, lowerNodes(d.value, st), ctx.init);
  }
}

/** The unnamed constructor: `this.x` parameters and initializers set fields; its body runs in `<init>`. */
function lowerConstructor(sig: SyntaxNode, body: SyntaxNode | undefined, fn: FunctionDef, ctx: ClassCtx): void {
  const params = field(sig, "parameters") ?? named(sig).find((c) => c.type === "formal_parameter_list");
  fn.params = lowerParams(params, ctx.st);
  const st = inFunction(ctx.st, fn, false);
  for (const name of fieldParams(params)) addField(ctx.cls, name, { k: "name", name, pos: fn.pos }, fn);
  const inits = named(sig.parent?.type === "method_signature" || sig.parent?.type === "declaration" ? sig.parent : sig).find((c) => c.type === "initializers");
  for (const entry of inits ? named(inits) : []) {
    const init = named(entry)[0];
    if (init?.type === "field_initializer") {
      const [id, ...value] = named(init).filter((c) => c.type !== "this");
      if (id) addField(ctx.cls, id.text, lowerNodes(value, st), fn);
    } else if (init) lowerArgs(named(entry).find((c) => c.type === "arguments"), st);
  }
  lowerBody(body, st);
}

/** A method, getter, setter, named constructor or factory. */
function lowerMethod(sig: SyntaxNode, body: SyntaxNode | undefined, isStatic: boolean, ctx: ClassCtx): void {
  const ids = named(sig).filter((c) => c.type === "identifier");
  const ctor = sig.type.includes("constructor");
  // `Api.named(...)`, `factory Api.make()`: the name after the class's; the unnamed constructor is `<init>`
  const name = ctor ? (ids.length > 1 ? ids.at(-1)!.text : undefined) : field(sig, "name")?.text;
  if (ctor && !name && !sig.type.startsWith("factory") && !sig.type.startsWith("redirecting")) return lowerConstructor(sig, body, ctx.init, ctx);
  const fn = newFunction(name ?? "<factory>", ctx.cls.module, sig, { cls: ctx.cls, isStatic: isStatic || ctor, ...(sig.type === "getter_signature" ? { isProperty: true } : {}) });
  ctx.cls.module.allFunctions.push(fn);
  const key = sig.type === "setter_signature" ? `${fn.name}=` : fn.name;
  if (name && !ctx.cls.methods.has(key)) ctx.cls.methods.set(key, fn);
  if (ctor && !sig.type.startsWith("factory") && !sig.type.startsWith("redirecting")) {
    lowerConstructor(sig, body, fn, ctx);
    fn.returns.push({ k: "call", fn: { k: "name", name: ctx.cls.name, pos: fn.pos }, args: [], pos: fn.pos });
    return;
  }
  fn.params = lowerParams(field(sig, "parameters") ?? named(sig).find((c) => c.type === "formal_parameter_list"), ctx.st);
  lowerBody(body, inFunction(ctx.st, fn, false));
  if (sig.type === "getter_signature" && name) for (const r of fn.returns) addField(ctx.cls, name, r, fn);
}

function lowerMember(sig: SyntaxNode, body: SyntaxNode | undefined, ctx: ClassCtx): void {
  if (sig.type === "enum_constant") {
    lowerArgs(named(named(sig).find((c) => c.type === "argument_part") ?? sig).find((c) => c.type === "arguments"), inFunction(ctx.st, ctx.init, false));
    return;
  }
  const isStatic = sig.children.some((c) => c?.type === "static");
  const inner = named(sig).find((c) => SIGNATURES.has(c.type));
  if (inner) return lowerMethod(inner, body, isStatic, ctx);
  lowerFields(sig, ctx);
}

/** The class a declaration defines (a class, mixin, enum or extension), registered in the module by name. */
function newClass(n: SyntaxNode, name: string, st: DartState): ClassDef {
  const qname = st.mod.name ? `${st.mod.name}.${name}` : name;
  const cls: ClassDef = { name, qname, bases: [], methods: new Map(), fields: new Map(), fieldTypes: new Map(), annotations: [], module: st.mod };
  // `extends B with M, N`: members are inherited from the superclass and the mixins
  const sup = field(n, "superclass") ?? named(n).find((c) => c.type === "superclass");
  const mixins = sup ? named(sup).find((x) => x.type === "mixins") : undefined;
  for (const c of sup ? [...named(sup), ...(mixins ? named(mixins) : [])] : []) {
    if (c.type === "type_identifier") cls.bases.push({ k: "name", name: c.text, pos: posOf(c) });
  }
  if (!st.mod.classes.has(name)) st.mod.classes.set(name, cls);
  return cls;
}

export function lowerClass(n: SyntaxNode, st: DartState): void {
  const nameNode = field(n, "name") ?? named(n).find((c) => c.type === "identifier");
  const body = field(n, "body") ?? named(n).find((c) => c.type === "class_body" || c.type === "enum_body" || c.type === "extension_body");
  if (!nameNode) return void lowerOther(n, st);
  const cls = newClass(n, nameNode.text, st);
  const init = newFunction("<init>", st.mod, n, { cls });
  st.mod.allFunctions.push(init);
  cls.methods.set("<init>", init);
  const ctx: ClassCtx = { cls, init, st: { ...st, fn: init, cls: { def: cls, members: memberNames(body) }, scope: { names: new Set() } } };
  for (const m of body ? members(body) : []) lowerMember(m.sig, m.body, ctx);
}
