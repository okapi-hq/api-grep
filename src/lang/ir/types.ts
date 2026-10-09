import type { Shape } from "../../types.js";
import type { ClassDef, Expr, FunctionDef } from "./model.js";
import { bindingOfPath, lookup, projectBases } from "./project.js";
import type { IrCtx } from "./raw.js";

const SCALARS: Record<string, Shape> = {
  str: { type: "string" },
  string: { type: "string" },
  bytes: { type: "string" },
  int: { type: "integer" },
  integer: { type: "integer" },
  float: { type: "number" },
  Decimal: { type: "number" },
  bool: { type: "boolean" },
  boolean: { type: "boolean" },
  UUID: { type: "string", hint: "uuid" },
  datetime: { type: "string", hint: "createdAt" },
  date: { type: "string", hint: "date" },
  EmailStr: { type: "string", hint: "email" },
  HttpUrl: { type: "string", hint: "url" },
};
const MAPPINGS = new Set(["dict", "Dict", "Mapping", "MutableMapping", "array", "object", "Any", "JSON", "Json"]);
const SEQUENCES = new Set(["list", "List", "Sequence", "tuple", "Tuple", "set", "Set", "Iterable"]);
const MAX_DEPTH = 4;

const lastName = (e: Expr): string | undefined => (e.k === "name" ? e.name : e.k === "attr" ? e.name : e.k === "qname" ? e.path[e.path.length - 1] : undefined);

/** A scalar declared type (`int`, `str`, PHP `string`): the shape of a path or query value. */
export function scalarShape(type: Expr): Shape | undefined {
  const name = lastName(type);
  return name ? SCALARS[name] : undefined;
}

function classOf(type: Expr, fn: FunctionDef, ctx: IrCtx): ClassDef | undefined {
  if (type.k === "name") {
    const b = lookup(type.name, fn, undefined, ctx.idx);
    return b.kind === "class" ? b.cls : undefined;
  }
  if (type.k === "qname") {
    const b = bindingOfPath(type.path, ctx.idx);
    return b.kind === "class" ? b.cls : undefined;
  }
  if (type.k === "attr" && type.obj.k === "name") {
    const owner = lookup(type.obj.name, fn, undefined, ctx.idx);
    if (owner.kind === "module") return owner.mod.classes.get(type.name);
  }
  return undefined;
}

/** Fields of a dataclass / TypedDict / pydantic model (bases first) as an object shape named after the class. */
export function classShape(cls: ClassDef, ctx: IrCtx, depth = 0): Shape | undefined {
  const properties: Record<string, Shape> = {};
  const required: string[] = [];
  const add = (c: ClassDef, seen: Set<ClassDef>): void => {
    if (seen.has(c)) return;
    seen.add(c);
    for (const b of projectBases(c, ctx.idx)) add(b, seen);
    for (const a of c.annotations) {
      properties[a.name] = typeShape(a.type, c.module.top, ctx, depth + 1) ?? { type: "unknown" };
      if (!a.optional && !required.includes(a.name)) required.push(a.name);
    }
  };
  add(cls, new Set());
  if (Object.keys(properties).length === 0) return undefined;
  return { type: "object", properties, required, fromType: cls.name };
}

/** The shape a declared type promises: scalars, containers, and project classes with annotated fields. */
export function typeShape(type: Expr, fn: FunctionDef, ctx: IrCtx, depth = 0): Shape | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const scalar = scalarShape(type);
  if (scalar) return scalar;
  if (type.k === "index") {
    const outer = lastName(type.obj);
    const inner = type.key.k === "list" ? type.key.items : [type.key];
    if (outer && SEQUENCES.has(outer)) return { type: "array", items: (inner[0] && typeShape(inner[0], fn, ctx, depth + 1)) ?? { type: "unknown" } };
    if (outer && MAPPINGS.has(outer)) return { type: "object", properties: {}, required: [], dynamicKeys: true };
    return undefined;
  }
  const name = lastName(type);
  if (name && SEQUENCES.has(name)) return { type: "array", items: { type: "unknown" } };
  if (name && MAPPINGS.has(name)) return { type: "object", properties: {}, required: [], dynamicKeys: true };
  const cls = classOf(type, fn, ctx);
  return cls ? classShape(cls, ctx, depth + 1) : undefined;
}

/** A project class with annotated fields that a call builds (`CreateUser(email=...)`). */
export function constructedClass(callee: Expr, fn: FunctionDef, ctx: IrCtx): ClassDef | undefined {
  const cls = classOf(callee, fn, ctx);
  return cls && cls.annotations.length > 0 ? cls : undefined;
}
