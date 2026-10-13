import type { ClassDef, Expr, FunctionDef } from "../ir/model.js";
import { injectedValue, isTransient, serialName } from "../jvm/annotations.js";
import type { SyntaxNode } from "../tree-sitter.js";
import { lowerArgs, lowerExpr } from "./lower-expr.js";
import { lowerMethod, lowerParams, modifiersNode, modifiersOf } from "./lower-fn.js";
import { addField, lowerStatement } from "./lower-stmt.js";
import { named, newFunction, posOf, setHooks, type JState } from "./state.js";
import { lowerType } from "./types.js";

const CLASSES = new Set(["class_declaration", "interface_declaration", "enum_declaration", "record_declaration"]);

/** Members of a class, interface, enum (its constants and the declarations after them) or record body. */
function bodyMembers(n: SyntaxNode): SyntaxNode[] {
  const body = n.childForFieldName("body");
  return body ? named(body).flatMap((c) => (c.type === "enum_body_declarations" ? named(c) : [c])) : [];
}

const declarators = (m: SyntaxNode): SyntaxNode[] => m.childrenForFieldName("declarator").filter((d): d is SyntaxNode => !!d);

/** Names a bare identifier in the class can mean: fields, constants, methods, enum constants, nested classes, record components. */
function memberNames(n: SyntaxNode): Set<string> {
  const names = new Set<string>();
  for (const m of bodyMembers(n)) {
    if (m.type === "field_declaration" || m.type === "constant_declaration") for (const d of declarators(m)) names.add(d.childForFieldName("name")?.text ?? "");
    else if (m.type === "method_declaration" || m.type === "enum_constant" || CLASSES.has(m.type)) names.add(m.childForFieldName("name")?.text ?? "");
  }
  for (const p of named(n.childForFieldName("parameters") ?? n).filter((c) => c.type === "formal_parameter")) names.add(p.childForFieldName("name")?.text ?? "");
  names.delete("");
  return names;
}

interface Members {
  /** `<init>`: instance field initializers, initializer blocks and the constructor with the most parameters. */
  init: JState;
  /** `<clinit>`: static field initializers, static blocks and enum constants. */
  clinit: JState;
  /** Where methods are lowered: the class's members in scope, no local names. */
  methods: JState;
  cls: ClassDef;
  /** Instance fields are the fields of a serialized object (a request body): classes and records. */
  body: boolean;
  /** Interface fields are constants. */
  constants: boolean;
  ctor?: SyntaxNode;
}

/** Nullable or optional fields may be left out of a body. */
const optionalField = (type: Expr | undefined, annotations: { type: Expr }[]): boolean =>
  (type?.k === "index" && type.obj.k === "name" && type.obj.name === "Optional") || annotations.some((a) => /^Nullable$/.test(a.type.k === "name" ? a.type.name : a.type.k === "attr" ? a.type.name : ""));

/** `private static final String BASE = "..."`, `@Value("${api.url}") String url;`, `@JsonProperty("id") long id;`. */
function lowerField(m: SyntaxNode, ctx: Members): void {
  const mods = modifiersOf(modifiersNode(m), ctx.methods);
  const isStatic = ctx.constants || mods.keywords.has("static");
  const st = isStatic ? ctx.clinit : { ...ctx.init, scope: { names: new Set<string>() } };
  const type = lowerType(m.childForFieldName("type") ?? undefined, ctx.methods);
  for (const d of declarators(m)) {
    const name = d.childForFieldName("name")?.text;
    if (!name) continue;
    const v = d.childForFieldName("value");
    const value = injectedValue(mods.annotations) ?? (v ? lowerExpr(v, st) : undefined);
    if (value) addField(ctx.cls, name, value, st.fn);
    if (!type) continue;
    ctx.cls.fieldTypes.set(name, type);
    if (ctx.body && !isStatic && !mods.keywords.has("transient") && !isTransient(mods.annotations)) {
      const json = serialName(mods.annotations);
      ctx.cls.annotations.push({ name: json ?? name, type, optional: optionalField(type, mods.annotations), ...(json && json !== name ? { field: name } : {}) });
    }
  }
}

/** A constructor other than `<init>`: a function of its own (`this.url = url` in it is a field value read there). */
function lowerConstructor(m: SyntaxNode, ctx: Members): void {
  const fn = newFunction("constructor", ctx.cls.module, m, { cls: ctx.cls });
  ctx.cls.module.allFunctions.push(fn);
  fn.params = lowerParams(m.childForFieldName("parameters") ?? undefined, { ...ctx.methods, fn });
  const body = m.childForFieldName("body");
  if (body) lowerStatement(body, { ...ctx.methods, fn, scope: { names: new Set(fn.params.map((p) => p.name)) }, builders: new Map() });
}

/** `A("a")`, `B { ... }`: a field of the enum holding its construction; a constant's own methods are closures. */
function lowerEnumConstant(m: SyntaxNode, ctx: Members): void {
  const name = m.childForFieldName("name");
  const args = lowerArgs(m.childForFieldName("arguments") ?? undefined, ctx.clinit);
  if (name) addField(ctx.cls, name.text, { k: "call", fn: { k: "qname", path: ctx.cls.qname.split("."), pos: posOf(m) }, args, pos: posOf(m) }, ctx.clinit.fn);
  for (const c of named(m.childForFieldName("body") ?? m)) if (c.type === "method_declaration") lowerMethod(c, ctx.methods, false);
}

function lowerMember(m: SyntaxNode, ctx: Members): void {
  switch (m.type) {
    case "field_declaration":
    case "constant_declaration":
      return lowerField(m, ctx);
    case "method_declaration": {
      const fn = lowerMethod(m, ctx.methods, false);
      if (!ctx.cls.methods.has(fn.name)) ctx.cls.methods.set(fn.name, fn);
      return;
    }
    case "constructor_declaration":
    case "compact_constructor_declaration": {
      const body = m.childForFieldName("body");
      if (m !== ctx.ctor && m.type === "constructor_declaration") return lowerConstructor(m, ctx);
      if (body) lowerStatement(body, ctx.init);
      return;
    }
    case "block":
      return lowerStatement(m, { ...ctx.init, scope: { names: new Set() } });
    case "static_initializer":
      for (const b of named(m)) lowerStatement(b, ctx.clinit);
      return;
    case "enum_constant":
      return lowerEnumConstant(m, ctx);
    default:
      if (CLASSES.has(m.type)) lowerClass(m, ctx.methods, true);
  }
}

/** `extends B implements C, D` (an interface's `extends`): the declared base types. */
function basesOf(n: SyntaxNode, st: JState): Expr[] {
  const lists = named(n).filter((c) => c.type === "superclass" || c.type === "super_interfaces" || c.type === "extends_interfaces");
  return lists.flatMap((l) => named(l).flatMap((c) => (c.type === "type_list" ? named(c) : [c]))).flatMap((t) => lowerType(t, st) ?? []);
}

/** The class a declaration defines, registered in the module (nested ones under `Outer.Inner`, and as `Outer`'s field). */
function newClass(n: SyntaxNode, st: JState, register: boolean): ClassDef {
  const name = n.childForFieldName("name")?.text ?? "anonymous";
  const outer = st.cls?.def;
  const qname = outer ? `${outer.qname}.${name}` : st.mod.name ? `${st.mod.name}.${name}` : name;
  const cls: ClassDef = { name, qname, bases: basesOf(n, st), methods: new Map(), fields: new Map(), fieldTypes: new Map(), annotations: [], module: st.mod };
  const anns = modifiersOf(modifiersNode(n), st).annotations;
  if (anns.length > 0) cls.classAnnotations = anns;
  if (!register) return cls;
  st.mod.classes.set(st.mod.name && qname.startsWith(`${st.mod.name}.`) ? qname.slice(st.mod.name.length + 1) : qname, cls);
  if (outer) addField(outer, name, { k: "qname", path: qname.split("."), pos: posOf(n) }, st.mod.top);
  return cls;
}

/** The constructor `<init>` stands for: the one with the most parameters, which the others usually delegate to. */
function widestConstructor(members: SyntaxNode[]): SyntaxNode | undefined {
  const count = (c: SyntaxNode): number => named(c.childForFieldName("parameters") ?? c).filter((p) => p.type !== "receiver_parameter").length;
  return members.filter((m) => m.type === "constructor_declaration").reduce<SyntaxNode | undefined>((best, c) => (!best || count(c) > count(best) ? c : best), undefined);
}

/** A record's components: parameters of `<init>` and fields, a body's properties under their JSON names. */
function recordComponents(init: FunctionDef, cls: ClassDef): void {
  for (const p of init.params) {
    addField(cls, p.name, { k: "name", name: p.name, pos: init.pos }, init);
    if (!p.type) continue;
    cls.fieldTypes.set(p.name, p.type);
    const anns = p.annotations ?? [];
    if (!isTransient(anns)) cls.annotations.push({ name: serialName(anns) ?? p.name, type: p.type, optional: optionalField(p.type, anns) });
  }
}

/** A class, interface, enum or record: `<init>` and `<clinit>` hold what runs when an instance or the class is made. */
function lowerClass(n: SyntaxNode, st: JState, register: boolean): void {
  if (!CLASSES.has(n.type)) return;
  const cls = newClass(n, st, register);
  const init = newFunction("<init>", st.mod, n, { cls });
  const clinit = newFunction("<clinit>", st.mod, n, { cls, isStatic: true });
  st.mod.allFunctions.push(init, clinit);
  cls.methods.set("<init>", init);
  const types = new Set(bodyMembers(n).flatMap((m) => (CLASSES.has(m.type) ? (m.childForFieldName("name")?.text ?? []) : [])));
  const scope = { def: cls, members: memberNames(n), types, ...(st.cls ? { outer: st.cls } : {}) };
  const members = bodyMembers(n);
  const ctor = n.type === "record_declaration" ? n : widestConstructor(members);
  const base: JState = { ...st, cls: scope, scope: { names: new Set() }, builders: new Map() };
  init.params = lowerParams(ctor?.childForFieldName("parameters") ?? undefined, { ...base, fn: init });
  const ctx: Members = {
    init: { ...base, fn: init, scope: { names: new Set(init.params.map((p) => p.name)) } },
    clinit: { ...base, fn: clinit },
    methods: base,
    cls,
    body: n.type === "class_declaration" || n.type === "record_declaration",
    constants: n.type === "interface_declaration",
    ctor,
  };
  if (n.type === "record_declaration") recordComponents(init, cls);
  for (const m of members) lowerMember(m, ctx);
}

/**
 * The body of `new Callback() { ... }`: its methods are closures of the code around it, its field initializers run
 * there. One with a single method (`new Interceptor() { public Response intercept(...) }`) stands for it, like a lambda.
 */
function lowerAnonymousClass(body: SyntaxNode, st: JState): FunctionDef | undefined {
  const fns: FunctionDef[] = [];
  for (const m of named(body)) {
    if (m.type === "method_declaration") fns.push(lowerMethod(m, st, true));
    else if (m.type === "block") lowerStatement(m, st);
    else if (m.type === "field_declaration") {
      for (const v of declarators(m).flatMap((d) => d.childForFieldName("value") ?? [])) lowerExpr(v, st);
    }
  }
  return fns.length === 1 ? fns[0] : undefined;
}

setHooks({ classDecl: lowerClass, anonymousClass: lowerAnonymousClass });

