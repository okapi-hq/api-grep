import { Node, type Expression } from "ts-morph";
import { isUndefinedLiteral, unwrap } from "../ast/expr.js";
import { propertyKey, propertyValue } from "../ast/object.js";
import { isSafeKey } from "../record-keys.js";
import type { DynamicOrigin, DynamicPart, Shape } from "../types.js";
import { editsBefore, reachOf, type ObjectEdit, type Reach } from "./object-edits.js";
import { unionOf } from "./shape-utils.js";
import { isNullable } from "./type-shape.js";

/**
 * The shape of an object variable where it is used, with the keys later statements add (`params.k = v`,
 * `Object.assign`) or remove (`delete params.k`). A key added in a block that may not run is optional unless every
 * branch of an `if` / `else` chain adds it; a key set on several paths keeps each value as an alternative.
 */

export interface ValueShape {
  shape: Shape;
  fromLiteral: boolean;
  origin?: DynamicOrigin;
}

type ObjectShape = Extract<Shape, { type: "object" }>;
type Item = { key: string; value: ValueShape; required: boolean } | { key: string; remove: true } | { dynamicKeys: true };

const originOf = (s: Shape): string => (s.type === "dynamic" ? s.origin : s.type === "unknown" ? "unknown" : "type");

function setItem(key: string, value: ValueShape): Item {
  return { key, value, required: value.fromLiteral || !isNullable(value.shape) };
}

/** `Object.assign(params, value)`: the keys of an object literal, else of the value's shape. */
function mergeItems(value: Expression, shapeOf: (e: Expression) => ValueShape): Item[] {
  const u = unwrap(value);
  if (!Node.isObjectLiteralExpression(u)) {
    const s = shapeOf(u).shape;
    if (s.type !== "object") return [{ dynamicKeys: true }];
    const items: Item[] = Object.entries(s.properties).map(([key, shape]) => ({ key, value: { shape, fromLiteral: false }, required: s.required.includes(key) }));
    return s.dynamicKeys ? [...items, { dynamicKeys: true }] : items;
  }
  return u.getProperties().flatMap((member): Item[] => {
    if (Node.isSpreadAssignment(member)) return mergeItems(member.getExpression(), shapeOf);
    const key = propertyKey(member);
    const v = propertyValue(member);
    if (key === undefined) return [{ dynamicKeys: true }];
    return v && !isUndefinedLiteral(v) ? [setItem(key, shapeOf(v))] : [];
  });
}

function itemsOf(edit: ObjectEdit, shapeOf: (e: Expression) => ValueShape): Item[] {
  if (edit.kind === "remove") return [{ key: edit.key, remove: true }];
  if (edit.kind === "set") return isUndefinedLiteral(edit.value) ? [{ key: edit.key, remove: true }] : [setItem(edit.key, shapeOf(edit.value))];
  return mergeItems(edit.value, shapeOf);
}

const setRequired = (acc: ObjectShape, key: string, on: boolean): void => {
  const has = acc.required.includes(key);
  if (on && !has) acc.required.push(key);
  if (!on && has) acc.required = acc.required.filter((k) => k !== key);
};

/** Per key, the branches of each `if` / `else` chain that set it, and how many branches the chain has. */
type Coverage = Map<string, Map<number, { seen: Set<number>; size: number }>>;

function apply(acc: ObjectShape, item: Item, reach: Reach, coverage: Coverage, dynamic: DynamicPart[]): void {
  // `params.__proto__ = ...`: a key a report record cannot hold
  if ("dynamicKeys" in item || !isSafeKey(item.key)) {
    acc.dynamicKeys = true;
    return;
  }
  const always = reach.kind === "always";
  if ("remove" in item) {
    coverage.delete(item.key);
    if (always) delete acc.properties[item.key];
    setRequired(acc, item.key, false);
    return;
  }
  const prev = acc.properties[item.key];
  acc.properties[item.key] = prev && !always ? unionOf([prev, item.value.shape]) : item.value.shape;
  if (always) setRequired(acc, item.key, item.required);
  if (!item.value.fromLiteral) dynamic.push({ where: "body", name: item.key, origin: item.value.origin ?? originOf(item.value.shape) });
  if (reach.kind !== "group" || !item.required) return;
  const groups = coverage.get(item.key) ?? new Map<number, { seen: Set<number>; size: number }>();
  coverage.set(item.key, groups);
  const g = groups.get(reach.group) ?? { seen: new Set<number>(), size: reach.size };
  groups.set(reach.group, g);
  g.seen.add(reach.branch);
}

/**
 * `const email = new SendSmtpEmail()` then `email.subject = s`: a library's model built with no arguments and filled by
 * property sets (openapi-generator SDKs) is the object of those properties. A class the project declares may set fields
 * of its own: not read so.
 */
export function isFilledModel(init: Expression, decl: Node, use: Node): boolean {
  const u = unwrap(init);
  if (!Node.isNewExpression(u) || u.getArguments().length > 0) return false;
  const symbol = u.getExpression().getSymbol();
  const target = symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol;
  if ((target?.getDeclarations() ?? []).some((d) => !d.getSourceFile().isDeclarationFile())) return false;
  return editsBefore(decl, use).some((e) => e.kind === "set");
}

/** `shape` (the object a variable is initialized with) as seen at `use`, once the edits before it are applied. */
export function withEdits(shape: Shape, decl: Node, use: Node, shapeOf: (e: Expression) => ValueShape, dynamic: DynamicPart[]): Shape {
  if (shape.type !== "object") return shape;
  const edits = editsBefore(decl, use);
  if (edits.length === 0) return shape;
  const acc: ObjectShape = { ...shape, properties: { ...shape.properties }, required: [...shape.required] };
  const coverage: Coverage = new Map();
  for (const edit of edits) {
    const reach = reachOf(edit.node, use);
    for (const item of itemsOf(edit, shapeOf)) apply(acc, item, reach, coverage, dynamic);
  }
  for (const [key, groups] of coverage) if ([...groups.values()].some((g) => g.seen.size === g.size) && key in acc.properties) setRequired(acc, key, true);
  return acc;
}
