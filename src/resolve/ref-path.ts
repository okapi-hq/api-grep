import { Node, type CallExpression, type Expression } from "ts-morph";
import { unwrap } from "../detect/callee.js";
import { declarationsOf, paramSubstitution } from "../detect/options.js";
import type { EvalCtx, Part } from "../types.js";
import { evaluate } from "./evaluate.js";

const MAX_DEPTH = 6;
/** Firebase reference builders: `doc(db, "users", id)`, `collection(ref, "posts")`, `ref(storage, path)`; `query(ref, ...)` keeps its ref. */
const BUILDERS = new Set(["doc", "collection", "collectionGroup", "ref", "child"]);

function builderName(call: CallExpression): string | undefined {
  const callee = unwrap(call.getExpression() as Expression);
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
}

/** The expression an identifier stands for: its initializer, or the caller's argument when it is a wrapper parameter. */
function follow(u: Expression, ctx: EvalCtx): { expr?: Expression; param: boolean } {
  for (const decl of declarationsOf(u)) {
    const sub = paramSubstitution(decl, ctx);
    if (sub.isParam) return { expr: sub.expr, param: true };
    if (Node.isVariableDeclaration(decl)) return { expr: decl.getInitializer(), param: false };
  }
  return { param: false };
}

function joinSegments(segments: Part[][]): Part[] {
  return segments.flatMap((s, i) => (i === 0 ? s : [{ kind: "static", text: "/" } as Part, ...s]));
}

/** A builder call, or an identifier that holds one; anything else (the db / storage instance) is not a reference. */
function asBuilder(expr: Expression, ctx: EvalCtx, depth: number): CallExpression | undefined {
  const u = unwrap(expr);
  if (depth > MAX_DEPTH) return undefined;
  if (Node.isCallExpression(u)) {
    const name = builderName(u);
    return name && (BUILDERS.has(name) || name === "query") ? u : undefined;
  }
  if (Node.isIdentifier(u)) {
    const { expr: next } = follow(u, ctx);
    return next ? asBuilder(next, ctx, depth + 1) : undefined;
  }
  return undefined;
}

function builderParts(call: CallExpression, ctx: EvalCtx, depth: number): Part[] {
  const name = builderName(call)!;
  const args = call.getArguments() as Expression[];
  if (name === "query") return args[0] ? refParts(args[0], ctx, depth + 1) : [{ kind: "dynamic", name: "ref", origin: "unknown" }];
  const [parent, ...segArgs] = args;
  const parentCall = parent ? asBuilder(parent, ctx, depth + 1) : undefined;
  const prefix = parentCall ? builderParts(parentCall, ctx, depth + 1) : [];
  const segments = segArgs.map((a) => evaluate(a, ctx, depth + 1));
  if (name === "doc" && segArgs.length === 0) segments.push([{ kind: "dynamic", name: "id", origin: "unknown" }]);
  return joinSegments([...(prefix.length > 0 ? [prefix] : []), ...segments]);
}

/** Path of a Firebase document / collection / storage reference: `doc(db, "users", uid)` -> `users/{uid}`. */
export function refParts(expr: Expression, ctx: EvalCtx = {}, depth = 0): Part[] {
  const u = unwrap(expr);
  const builder = asBuilder(u, ctx, depth);
  if (builder) return builderParts(builder, ctx, depth);
  if (Node.isIdentifier(u)) {
    const { expr: next, param } = follow(u, ctx);
    if (next && depth < MAX_DEPTH) return refParts(next, ctx, depth + 1);
    return [{ kind: "dynamic", name: u.getText(), origin: param ? "param" : "unknown" }];
  }
  return [{ kind: "dynamic", name: "ref", origin: "unknown" }];
}
