import type { AuthScheme, BodyEncoding } from "../../types.js";
import type { Chain } from "./chain.js";
import { argOf, arrayOptions, kwargOptions, type Options } from "./args.js";
import type { ClientFunction, ClientSpec, OptionRole, Scoped } from "./language.js";
import type { CallExpr, FunctionDef } from "./model.js";
import type { IrCtx, IrRaw, Seg } from "./raw.js";
import { authOfOption } from "./request.js";
import { rootLength } from "./sdk.js";

const BODY_ROLES: OptionRole[] = ["body:json", "body:form", "body:multipart", "body:raw", "body"];

interface Shape {
  instance?: Seg;
  modifiers: Seg[];
}

/** What sits between the import root and the request: nothing, a client object, fluent modifiers. */
function middleOf(spec: ClientSpec, middle: Seg[]): Shape | undefined {
  const out: Shape = { modifiers: [] };
  for (const s of middle) {
    if ((s.call || s.typed) && !out.instance && out.modifiers.length === 0 && spec.instances?.names.includes(s.name)) out.instance = s;
    else if (s.call && spec.modifiers?.[s.name]) out.modifiers.push(s);
    else return undefined;
  }
  return out;
}

function optionsOf(spec: ClientSpec, seg: Seg, optionsArg: number | undefined, ctx: IrCtx): Options {
  if (!seg.call || !seg.fn) return { get: () => undefined, values: () => [], opaque: false };
  if (optionsArg !== undefined) return arrayOptions(argOf(seg, optionsArg), ctx);
  return kwargOptions(seg.call, seg.fn, ctx);
}

/** The first option carrying a role (`json=` before `data=`). */
function byRole(spec: ClientSpec, opts: Options, role: OptionRole): { value: Scoped; key: string } | undefined {
  for (const [key, r] of Object.entries(spec.keys)) {
    if (r !== role) continue;
    const value = opts.get(key);
    if (value) return { value, key };
  }
  return undefined;
}

function bodyFrom(spec: ClientSpec, f: ClientFunction, method: Seg, opts: Options): { body?: Scoped; role?: OptionRole } {
  const positional = f.bodyArg !== undefined ? argOf(method, f.bodyArg) : undefined;
  if (positional) return { body: positional, role: f.bodyRole ?? "body" };
  for (const role of BODY_ROLES) {
    const hit = byRole(spec, opts, role);
    if (hit) return { body: hit.value, role };
  }
  return {};
}

interface Modified {
  headers: Scoped[];
  baseUrl?: Scoped;
  query?: Scoped;
  auth?: AuthScheme;
  encoding?: BodyEncoding;
  options: Options[];
}

/** Fluent modifiers: `withToken()` (auth), `asForm()` (encoding), `withHeaders([...])`, `baseUrl(...)`. */
function applyModifiers(spec: ClientSpec, mods: Seg[], ctx: IrCtx): Modified {
  const out: Modified = { headers: [], options: [] };
  for (const s of mods) {
    const m = spec.modifiers![s.name]!;
    if (m.auth) out.auth = m.auth;
    if (m.encoding) out.encoding = m.encoding;
    const at = (i: number | undefined): Scoped | undefined => (i !== undefined ? argOf(s, i) : undefined);
    const headers = at(m.headersArg);
    if (headers) out.headers.push(headers);
    out.baseUrl = at(m.baseUrlArg) ?? out.baseUrl;
    out.query = at(m.queryArg) ?? out.query;
    if (m.optionsArg !== undefined) out.options.push(arrayOptions(at(m.optionsArg), ctx));
  }
  return out;
}

function urlOf(f: ClientFunction, method: Seg, spec: ClientSpec, opts: Options): Scoped | undefined {
  return argOf(method, f.urlArg ?? 0) ?? byRole(spec, opts, "url")?.value;
}

function buildRaw(spec: ClientSpec, f: ClientFunction, method: Seg, shape: Shape, ctx: IrCtx): IrRaw {
  const opts = optionsOf(spec, method, f.optionsArg, ctx);
  const inst = shape.instance ? optionsOf(spec, shape.instance, spec.instances?.optionsArg, ctx) : undefined;
  const mod = applyModifiers(spec, shape.modifiers, ctx);
  const all = [opts, ...mod.options, ...(inst ? [inst] : [])];
  const pick = (role: OptionRole): Scoped | undefined => all.map((o) => byRole(spec, o, role)?.value).find((v) => v);
  const { body, role } = bodyFrom(spec, f, method, opts);
  const auth = pick("auth");
  const methodArg = f.methodArg !== undefined ? argOf(method, f.methodArg) : undefined;
  const raw: IrRaw = {
    call: method.call!,
    fn: method.fn!,
    client: spec.client,
    url: urlOf(f, method, spec, opts),
    baseUrl: mod.baseUrl ?? pick("baseUrl") ?? (shape.instance && spec.instances?.baseUrlArg !== undefined ? argOf(shape.instance, spec.instances.baseUrlArg) : undefined),
    impliedMethod: f.method,
    method: methodArg ?? (f.method ? undefined : pick("method")),
    body,
    bodyRole: role,
    encoding: mod.encoding,
    query: (f.queryArg !== undefined ? argOf(method, f.queryArg) : undefined) ?? mod.query ?? pick("query"),
    headers: [...all.map((o) => byRole(spec, o, "headers")?.value).filter((v): v is Scoped => !!v), ...mod.headers],
    auth: mod.auth ?? (auth ? authOfOption(auth, ctx) : undefined),
    optionsOpaque: opts.opaque,
    inputs: [],
  };
  raw.inputs = [raw.url, raw.baseUrl, raw.method, raw.body, raw.query, ...opts.values()].filter((v): v is Scoped => !!v);
  return raw;
}

/** An HTTP client call from the language's client tables (`requests.post(url, json=...)`, `client.get(url)`). */
export function detectHttp(chain: Chain, call: CallExpr, _fn: FunctionDef, ctx: IrCtx): IrRaw | undefined {
  if (chain.root.kind !== "external") return undefined;
  const method = chain.segs[chain.segs.length - 1];
  if (!method || method.call !== call) return undefined;
  for (const spec of ctx.idx.lang.clients) {
    const n = rootLength(chain.segs, spec.imports);
    if (n === 0 || n >= chain.segs.length) continue;
    const f = spec.functions[method.name];
    const shape = f ? middleOf(spec, chain.segs.slice(n, -1)) : undefined;
    if (f && shape) return buildRaw(spec, f, method, shape, ctx);
  }
  return undefined;
}
