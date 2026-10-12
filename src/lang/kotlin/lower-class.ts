import type { ClassDef, FunctionDef, Param } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { lowerArgs, lowerExpr } from "./lower-expr.js";
import { addField, lowerFunction, lowerParams, lowerStatement, propertyParts } from "./lower-stmt.js";
import { injectedValue, isTransient, modifiersOf, serialName } from "./modifiers.js";
import { newFunction, posOf, setHooks, type KtState } from "./state.js";
import { lowerType } from "./types.js";

type Kind = "class" | "interface" | "enum" | "object";

function kindOf(n: SyntaxNode): Kind {
  if (n.type === "object_declaration") return "object";
  if (n.children.some((c) => c?.type === "interface")) return "interface";
  const mods = named(n).find((c) => c.type === "modifiers");
  const words = new Set((mods ? named(mods) : []).map((c) => c.text));
  return words.has("enum") ? "enum" : "class";
}

const bodyOf = (n: SyntaxNode): SyntaxNode[] => named(n).filter((c) => c.type === "class_body" || c.type === "enum_class_body").flatMap(named);
const ctorParams = (n: SyntaxNode): SyntaxNode[] => named(named(named(n).find((c) => c.type === "primary_constructor") ?? n).find((c) => c.type === "class_parameters") ?? n).filter((c) => c.type === "class_parameter");
const declName = (m: SyntaxNode): string | undefined => (m.type === "property_declaration" ? named(named(m).find((c) => c.type === "variable_declaration") ?? m)[0]?.text : field(m, "name")?.text);

/** Names a bare identifier in the class can mean: constructor properties, members, companion members, nested classes. */
function memberNames(n: SyntaxNode): Set<string> {
  const names = new Set<string>();
  for (const p of ctorParams(n)) if (p.children.some((c) => c?.type === "val" || c?.type === "var")) names.add(named(p).find((c) => c.type === "identifier")?.text ?? "");
  const members = bodyOf(n);
  for (const m of [...members, ...members.filter((c) => c.type === "companion_object").flatMap(bodyOf)]) {
    const name = declName(m);
    if (name) names.add(name);
  }
  return names;
}

/** A primary constructor parameter: a parameter of `<init>`, and a field when it is a `val` / `var` property. */
function lowerCtorParam(p: SyntaxNode, index: number, st: KtState, cls: ClassDef, body: boolean): Param | undefined {
  const kids = named(p);
  const id = kids.find((c) => c.type === "identifier");
  if (!id) return undefined;
  const mods = modifiersOf(kids.find((c) => c.type === "modifiers"), st);
  const typeNode = kids.find((c) => c.type.endsWith("_type"));
  const { type, nullable } = lowerType(typeNode);
  const dflt = kids.filter((c) => c.id !== id.id && c.type !== "modifiers" && c.id !== typeNode?.id).pop();
  const value = injectedValue(mods.annotations) ?? (dflt ? lowerExpr(dflt, st) : undefined);
  const param: Param = { name: id.text, index, kind: "normal", ...(value ? { default: value } : {}), ...(type ? { type } : {}), ...(mods.annotations.length ? { annotations: mods.annotations } : {}) };
  if (!p.children.some((c) => c?.type === "val" || c?.type === "var")) return param;
  addField(cls, id.text, { k: "name", name: id.text, pos: posOf(id) }, st.fn);
  if (type) cls.fieldTypes.set(id.text, type);
  if (type && body && !isTransient(mods.annotations)) cls.annotations.push({ name: serialName(mods.annotations) ?? id.text, type, optional: nullable || !!dflt });
  return param;
}

/** A property of the class body (or of its companion): a field set where it is declared, typed when it says so. */
function lowerMemberProperty(m: SyntaxNode, st: KtState, cls: ClassDef, body: boolean): void {
  const p = propertyParts(m, st);
  if (!p.name) return;
  if (p.value) addField(cls, p.name, p.value, st.fn);
  if (!p.type) return;
  cls.fieldTypes.set(p.name, p.type);
  if (body && !p.hasGetter && !isTransient(p.mods.annotations)) cls.annotations.push({ name: serialName(p.mods.annotations) ?? p.name, type: p.type, optional: p.nullable || p.initialized });
}

interface Members {
  /** `<init>`: property initializers and `init` blocks read the constructor's parameters. */
  init: KtState;
  /** Where methods are lowered: the class's members in scope, no local names. */
  methods: KtState;
  cls: ClassDef;
  /** Properties are the fields of a serialized object (a request body), not of a singleton or a companion. */
  body: boolean;
}

/** A companion object's members are the class's own (`Api.BASE`, `Api.create()`); its initializers run apart. */
function lowerCompanion(m: SyntaxNode, ctx: Members): void {
  const clinit = newFunction("<clinit>", ctx.cls.module, m, { cls: ctx.cls });
  ctx.cls.module.allFunctions.push(clinit);
  addField(ctx.cls, field(m, "name")?.text ?? "Companion", { k: "qname", path: ctx.cls.qname.split("."), pos: posOf(m) }, ctx.cls.module.top);
  const inner: Members = { ...ctx, init: { ...ctx.init, fn: clinit, scope: { names: new Set() } }, body: false };
  for (const c of bodyOf(m)) lowerMember(c, inner);
}

function lowerMember(m: SyntaxNode, ctx: Members): void {
  switch (m.type) {
    case "property_declaration":
      return lowerMemberProperty(m, ctx.init, ctx.cls, ctx.body);
    case "function_declaration": {
      const fn = lowerFunction(m, ctx.methods, false);
      if (!ctx.cls.methods.has(fn.name)) ctx.cls.methods.set(fn.name, fn);
      return;
    }
    case "anonymous_initializer":
      for (const b of named(m)) lowerStatement(b, ctx.init);
      return;
    case "secondary_constructor": {
      const fn = newFunction("constructor", ctx.cls.module, m, { cls: ctx.cls });
      ctx.cls.module.allFunctions.push(fn);
      fn.params = lowerParams(named(m).find((c) => c.type === "function_value_parameters"), { ...ctx.methods, fn });
      const inner: KtState = { ...ctx.methods, fn, scope: { names: new Set(fn.params.map((p) => p.name)) } };
      for (const c of named(m)) if (c.type === "block" || c.type === "constructor_delegation_call") lowerStatement(c, inner);
      return;
    }
    case "companion_object":
      return lowerCompanion(m, ctx);
    case "class_declaration":
    case "object_declaration":
      return lowerClass(m, ctx.methods, true);
    case "enum_entry":
      lowerArgs(named(m).find((c) => c.type === "value_arguments"), ctx.init);
      for (const c of bodyOf(m)) lowerMember(c, ctx);
      return;
    default:
      return;
  }
}

/** The class a declaration defines, registered in the module (nested ones under `Outer.Inner`, and as `Outer`'s field). */
function newClass(n: SyntaxNode, st: KtState, register: boolean): ClassDef {
  const name = field(n, "name")?.text ?? "anonymous";
  const outer = st.cls?.def;
  const qname = outer ? `${outer.qname}.${name}` : st.mod.name ? `${st.mod.name}.${name}` : name;
  const cls: ClassDef = { name, qname, bases: [], methods: new Map(), fields: new Map(), fieldTypes: new Map(), annotations: [], module: st.mod };
  const anns = modifiersOf(named(n).find((c) => c.type === "modifiers"), st).annotations;
  if (anns.length > 0) cls.classAnnotations = anns;
  const specs = named(named(n).find((c) => c.type === "delegation_specifiers") ?? n).filter((c) => c.type === "delegation_specifier");
  for (const s of specs) {
    const target = named(s).find((c) => c.type === "constructor_invocation" || c.type === "explicit_delegation") ?? s;
    const type = lowerType(named(target).find((c) => c.type.endsWith("_type"))).type;
    if (type) cls.bases.push(type);
  }
  if (!register) return cls;
  st.mod.classes.set(st.mod.name && qname.startsWith(`${st.mod.name}.`) ? qname.slice(st.mod.name.length + 1) : qname, cls);
  if (outer) addField(outer, name, { k: "qname", path: qname.split("."), pos: posOf(n) }, st.mod.top);
  return cls;
}

/** A class, interface, `enum class` or `object`: `<init>` holds the primary constructor and the initializers. */
function lowerClass(n: SyntaxNode, st: KtState, register: boolean): void {
  const kind = kindOf(n);
  const cls = newClass(n, st, register);
  const init: FunctionDef = newFunction("<init>", st.mod, n, { cls });
  st.mod.allFunctions.push(init);
  cls.methods.set("<init>", init);
  const scope = { def: cls, members: memberNames(n) };
  const body = kind === "class";
  const initSt: KtState = { ...st, fn: init, cls: scope, scope: { names: new Set() } };
  init.params = ctorParams(n).flatMap((p, i) => lowerCtorParam(p, i, initSt, cls, body) ?? []);
  for (const p of init.params) initSt.scope.names.add(p.name);
  const ctx: Members = { init: initSt, methods: { ...st, cls: scope, scope: { names: new Set() } }, cls, body };
  for (const m of bodyOf(n)) lowerMember(m, ctx);
}

setHooks({ classDecl: lowerClass });
