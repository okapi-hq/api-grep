import { staticText } from "../../../resolve/parts.js";
import type { ClientKind } from "../../../report/schema.js";
import type { BodyEncoding } from "../../../types.js";
import type { Chain } from "../../ir/chain.js";
import { evaluate } from "../../ir/evaluate.js";
import type { Scoped } from "../../ir/language.js";
import type { CallExpr, FunctionDef } from "../../ir/model.js";
import type { IrCtx, IrPair, IrRaw } from "../../ir/raw.js";
import { rootLength } from "../../ir/sdk.js";
import { applyStep, argAt, calleeIs, composeUrl, emptyParts, fluentChain, readSteps, type RequestParts } from "../../ir/steps.js";
import { deref } from "../../ir/values.js";
import { encodingOfType, JVM } from "./tables.js";

/** A chain rooted in one of these packages (`okhttp3`, `java.net.http`). */
export const chainFrom = (chain: Chain, imports: string[]): boolean => chain.root.kind === "external" && rootLength(chain.segs, imports) > 0;

const MEDIA = /^[a-z]+\/[a-z0-9.+-]+/i;

const textOf = (s: Scoped | undefined, ctx: IrCtx): string | undefined => (s ? staticText(evaluate(s.expr, s.fn, ctx)) : undefined);

/** `RequestBody.create(mediaType, json)` (OkHttp 3) or `create(json, mediaType)` (OkHttp 4): the argument that is not a media type. */
function contentAndMedia(call: CallExpr, fn: FunctionDef, ctx: IrCtx): { value?: Scoped; media?: Scoped } {
  const [a, b] = [argAt({ call, fn }, 0), argAt({ call, fn }, 1)];
  return MEDIA.test(textOf(a, ctx) ?? "") ? { value: b, media: a } : { value: a, media: b };
}

/**
 * A body behind its wrapper and the encoding its content type gives: `json.toRequestBody("application/json"
 * .toMediaType())`, `BodyPublishers.ofString(json)`, `BodyInserters.fromValue(item)`.
 */
export function unwrapBody(s: Scoped | undefined, ctx: IrCtx): { body?: Scoped; encoding?: BodyEncoding } {
  let cur = s;
  let encoding: BodyEncoding | undefined;
  for (let i = 0; cur && i < 3; i++) {
    const d = deref(cur.expr, cur.fn, ctx);
    const call = d.expr.k === "call" ? d.expr : undefined;
    const name = call ? calleeIs(call, Object.keys(JVM.bodies)) : undefined;
    if (!call || name === undefined) return { body: cur, encoding };
    const w = JVM.bodies[name]!;
    if (w.none) return {};
    const split = w.value === "content" ? contentAndMedia(call, d.fn, ctx) : undefined;
    const media = split ? split.media : typeof w.contentType === "number" ? argAt({ call, fn: d.fn }, w.contentType) : undefined;
    // `new StringEntity(json, "UTF-8")`: a charset, not a content type
    const type = textOf(media, ctx);
    encoding = encoding ?? w.encoding ?? encodingOfType(type && MEDIA.test(type) ? type : undefined);
    cur = split ? split.value : w.value === "receiver" && call.fn.k === "attr" ? { expr: call.fn.obj, fn: d.fn } : argAt({ call, fn: d.fn }, typeof w.value === "number" ? w.value : undefined);
  }
  return { body: cur, encoding };
}

/** The steps of a URL builder's chain (`HttpUrl.Builder`, `toHttpUrl().newBuilder()`, `UriComponentsBuilder`). */
export function urlParts(s: Scoped, ctx: IrCtx, parts = emptyParts()): RequestParts | undefined {
  const starts = Object.keys(JVM.urls.starts);
  const fc = fluentChain(s, (c) => calleeIs(c, starts) !== undefined, ctx);
  if (!fc.start) return undefined;
  applyStep(parts, JVM.urls.starts[calleeIs(fc.start.call, starts)!]!, fc.start);
  return readSteps(fc.steps, JVM.urls.steps, parts);
}

/** A URL value: itself, or the URL its builder composes, with the query parameters the builder adds. */
export function readUrl(s: Scoped | undefined, ctx: IrCtx): { url?: Scoped; pairs: IrPair[]; query?: Scoped } {
  if (!s) return { pairs: [] };
  const p = urlParts(s, ctx);
  if (!p) return { url: s, pairs: [] };
  if (p.url) p.url = readUrl(p.url, ctx).url;
  return { url: composeUrl(p), pairs: p.pairs, query: p.query };
}

/** The content type a `Content-Type` header pair gives, when its value is a literal. */
function headerType(pairs: IrPair[], ctx: IrCtx): string | undefined {
  const pair = pairs.find((p) => p.where === "header" && textOf(p.name, ctx)?.toLowerCase() === "content-type");
  return textOf(pair?.value, ctx);
}

/** The detected call: URL builders read, the body unwrapped, the encoding from the body's media type or content type. */
export function rawOf(call: CallExpr, fn: FunctionDef, client: ClientKind, p: RequestParts, ctx: IrCtx, extra: Scoped[] = []): IrRaw {
  const written = [p.url, ...p.path];
  const own = readUrl(p.url, ctx);
  p.url = own.url;
  const url = composeUrl(p);
  const { body, encoding } = unwrapBody(p.body, ctx);
  const pairs = [...own.pairs, ...p.pairs];
  const typed = encoding ?? encodingOfType(textOf(p.contentType, ctx) ?? headerType(pairs, ctx));
  const values = pairs.flatMap((x) => (x.value && !x.from ? [x.value] : []));
  return {
    call,
    fn,
    client,
    url,
    baseUrl: p.baseUrl,
    method: p.method,
    impliedMethod: p.impliedMethod,
    body,
    bodyRole: p.bodyRole,
    encoding: body ? typed : undefined,
    query: p.query ?? own.query,
    headers: p.headers,
    pairs,
    inputs: [url, ...written, p.baseUrl, p.method, body, ...values, ...extra].filter((v): v is Scoped => !!v),
  };
}
