import { Node, type Expression } from "ts-morph";
import { unwrap } from "../detect/callee.js";
import { getProp } from "../detect/options.js";
import type { EvalCtx, Part, UrlShape } from "../types.js";
import { collectAppended } from "./appended.js";
import { evalNewUrl, evaluate, partsToTemplate } from "./evaluate.js";
import { joinParts, partsToUrlShape, SCHEME_RE } from "./url-shape.js";

export { normalizePath, partsToUrlShape } from "./url-shape.js";

/** `searchParams.set("k", v)` calls become `?k={v}` parts so values keep their shape. */
function appendedQueryParts(u: Expression, ctx: EvalCtx, hasQuery: boolean): Part[] {
  const entries = Node.isIdentifier(u) ? collectAppended(u, ["set", "append"]) : [];
  const out: Part[] = [];
  entries.forEach((e, i) => {
    out.push({ kind: "static", text: `${i === 0 && !hasQuery ? "?" : "&"}${e.key}=` });
    if (e.value) out.push(...evaluate(e.value, ctx));
  });
  return out;
}

/** `this.config.url({ path: "/chat/completions" })` style builders: the base stays dynamic, the path is kept. */
function urlBuilderParts(u: Expression, ctx: EvalCtx): Part[] | undefined {
  if (!Node.isCallExpression(u)) return undefined;
  const arg = u.getArguments()[0];
  if (!arg || u.getArguments().length !== 1 || !Node.isObjectLiteralExpression(arg)) return undefined;
  const pathExpr = getProp(arg, "path", ctx) ?? getProp(arg, "pathname", ctx);
  if (!pathExpr) return undefined;
  const pathParts = evaluate(pathExpr, ctx);
  if (SCHEME_RE.test(partsToTemplate(pathParts))) return pathParts;
  const callee = u.getExpression();
  const name = Node.isPropertyAccessExpression(callee) ? callee.getName() : "baseUrl";
  return [{ kind: "dynamic", name: name === "url" ? "baseUrl" : name, origin: "call" }, ...pathParts];
}

export function urlParts(expr: Expression, ctx: EvalCtx): Part[] {
  const u = unwrap(expr);
  if (Node.isNewExpression(u) && u.getExpression().getText() === "URL") return evalNewUrl(u, ctx, 0);
  const built = urlBuilderParts(u, ctx);
  if (built) return built;
  const parts = evaluate(u, ctx);
  return [...parts, ...appendedQueryParts(u, ctx, partsToTemplate(parts).includes("?"))];
}

/** Resolves a URL expression (optionally prefixed by a baseURL / prefixUrl expression) to a UrlShape. */
export function resolveUrl(expr: Expression | undefined, ctx: EvalCtx = {}, base?: Expression): UrlShape {
  const baseParts = base ? urlParts(base, ctx) : [];
  const pathParts = expr ? urlParts(expr, ctx) : [];
  if (!expr && !base) {
    return { hostKind: "unknown", pathTemplate: "/", query: [], queryShape: {}, dynamic: [{ where: "host", name: "url", origin: "unknown" }], raw: "" };
  }
  return partsToUrlShape(joinParts(baseParts, pathParts), ctx);
}
