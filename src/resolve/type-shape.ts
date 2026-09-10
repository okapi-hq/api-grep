import { ts, type Node, type Type } from "ts-morph";
import type { Shape } from "../types.js";

const MAX_DEPTH = 5;
const MAX_PROPS = 80;
const ANON = new Set(["__type", "__object", "Object", "object"]);

export interface TypedShape {
  shape: Shape;
  optional: boolean;
}

export function typeName(t: Type): string | undefined {
  const name = t.getAliasSymbol()?.getName() ?? t.getSymbol()?.getName();
  if (!name || ANON.has(name)) return undefined;
  return name;
}

function typeId(t: Type): string {
  const id = (t.compilerType as unknown as { id?: number }).id;
  return id !== undefined ? String(id) : t.getText();
}

function literalShape(t: Type): Shape | undefined {
  if (t.isStringLiteral()) return { type: "string", enum: [String(t.getLiteralValue())] };
  if (t.isNumberLiteral()) return { type: "number", enum: [Number(t.getLiteralValue())] };
  if (t.isBooleanLiteral()) return { type: "boolean", enum: [t.getText() === "true"] };
  return undefined;
}

function primitiveShape(t: Type): Shape | undefined {
  if (t.isString() || t.isTemplateLiteral()) return { type: "string" };
  if (t.isNumber() || t.isBigInt()) return { type: "number" };
  if (t.isBoolean()) return { type: "boolean" };
  if (t.isNull()) return { type: "null" };
  if (t.isEnumLiteral() || t.isEnum()) return { type: "string" };
  return undefined;
}

export function mergeLiterals(shapes: Shape[]): Shape | undefined {
  const types = new Set(shapes.map((s) => s.type));
  if (types.size !== 1) return undefined;
  const type = shapes[0]!.type;
  if (type !== "string" && type !== "number" && type !== "boolean") return undefined;
  const values = shapes.flatMap((s) => ("enum" in s && s.enum ? s.enum : []));
  if (values.length !== shapes.length) return { type };
  if (type === "boolean" && values.length >= 2) return { type };
  return { type, enum: values };
}

function unionShape(t: Type, node: Node, depth: number, visited: Set<string>): TypedShape {
  const members = t.getUnionTypes();
  const optional = members.some((m) => m.isUndefined());
  const kept = members.filter((m) => !m.isUndefined());
  const hasNull = kept.some((m) => m.isNull());
  const nonNull = kept.filter((m) => !m.isNull());
  const shapes = nonNull.map((m) => typeToShape(m, node, depth + 1, visited).shape);
  let shape: Shape;
  if (shapes.length === 0) shape = { type: "null" };
  else if (shapes.length === 1) shape = shapes[0]!;
  else shape = mergeLiterals(shapes) ?? { type: "union", anyOf: dedupe(shapes) };
  if (hasNull && shape.type !== "null") shape = { type: "union", anyOf: [shape, { type: "null" }] };
  return { shape, optional };
}

export function dedupe(shapes: Shape[]): Shape[] {
  const seen = new Set<string>();
  return shapes.filter((s) => {
    const k = JSON.stringify(s);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const BINARY_RE = /^(Buffer|Blob|File|ReadableStream|Readable|ArrayBuffer|SharedArrayBuffer|DataView|ArrayBufferView|(?:Uint|Int)(?:8|16|32)(?:Clamped)?Array|Float(?:32|64)Array|Big(?:U)?Int64Array)$/;

function isBuiltinObject(t: Type): Shape | undefined {
  const name = t.getSymbol()?.getName();
  if (name === "Date") return { type: "string" };
  if (name && BINARY_RE.test(name)) return { type: "dynamic", origin: "unknown", hint: name };
  if (name === "Map" || name === "Set" || name === "Promise" || name === "FormData" || name === "URLSearchParams") return { type: "unknown" };
  return undefined;
}

function objectShape(t: Type, node: Node, depth: number, visited: Set<string>): Shape {
  const builtin = isBuiltinObject(t);
  if (builtin) return builtin;
  if (t.getCallSignatures().length > 0) return { type: "unknown" };
  const id = typeId(t);
  if (visited.has(id)) return { type: "unknown" };
  visited.add(id);
  const properties: Record<string, Shape> = {};
  const required: string[] = [];
  const props = t.getProperties();
  for (const prop of props.slice(0, MAX_PROPS)) {
    if (prop.getName().startsWith("__@")) continue;
    const pt = prop.getTypeAtLocation(node);
    if (pt.getCallSignatures().length > 0) continue;
    const sub = typeToShape(pt, node, depth + 1, visited);
    const optional = sub.optional || prop.hasFlags(ts.SymbolFlags.Optional);
    properties[prop.getName()] = sub.shape;
    if (!optional) required.push(prop.getName());
  }
  visited.delete(id);
  const dynamicKeys = t.getStringIndexType() !== undefined || props.length > MAX_PROPS;
  const shape: Shape = { type: "object", properties, required, ...(dynamicKeys ? { dynamicKeys: true } : {}) };
  const name = typeName(t);
  if (name) shape.fromType = name;
  return shape;
}

/** Converts a checker type into a Shape. `optional` reports whether `undefined` was part of the type. */
export function typeToShape(t: Type, node: Node, depth = 0, visited: Set<string> = new Set()): TypedShape {
  if (depth > MAX_DEPTH) return { shape: { type: "unknown" }, optional: false };
  if (t.isAny() || t.isUnknown() || t.isNever()) return { shape: { type: "unknown" }, optional: false };
  if (t.isUndefined()) return { shape: { type: "null" }, optional: true };
  if (t.isTypeParameter()) return { shape: { type: "dynamic", origin: "unknown", hint: t.getText() }, optional: false };
  const lit = literalShape(t);
  if (lit) return { shape: lit, optional: false };
  if (t.isUnion()) return unionShape(t, node, depth, visited);
  const prim = primitiveShape(t);
  if (prim) return { shape: prim, optional: false };
  if (t.isArray()) {
    const el = t.getArrayElementTypeOrThrow();
    return { shape: { type: "array", items: typeToShape(el, node, depth + 1, visited).shape }, optional: false };
  }
  if (t.isTuple()) {
    const items = dedupe(t.getTupleElements().map((e) => typeToShape(e, node, depth + 1, visited).shape));
    return { shape: { type: "array", items: items.length === 1 ? items[0]! : { type: "union", anyOf: items } }, optional: false };
  }
  if (t.isIntersection()) return intersectionShape(t, node, depth, visited);
  if (t.isObject() || t.isInterface() || t.isClass()) return { shape: objectShape(t, node, depth, visited), optional: false };
  return { shape: { type: "unknown" }, optional: false };
}

function intersectionShape(t: Type, node: Node, depth: number, visited: Set<string>): TypedShape {
  const props = t.getProperties();
  if (props.length > 0) return { shape: objectShape(t, node, depth, visited), optional: false };
  const parts = t.getIntersectionTypes().map((m) => typeToShape(m, node, depth + 1, visited).shape);
  return { shape: parts[0] ?? { type: "unknown" }, optional: false };
}
