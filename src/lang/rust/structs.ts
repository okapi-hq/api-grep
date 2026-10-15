import { calleeChain, valueChain } from "../ir/chain.js";
import { mayNotRun } from "../ir/edits.js";
import type { Scoped } from "../ir/language.js";
import type { Arg, CallExpr, ClassDef, Entry, Expr, FunctionDef } from "../ir/model.js";
import type { IrCtx } from "../ir/raw.js";

/**
 * Rust's `resolveCall`: a struct literal is the dict serde serializes it to (a project struct by its serde names, an
 * SDK's as written), with the fields set on its variable afterwards (`req.stream = Some(true)`); async-openai's request
 * builders (`CreateChatCompletionRequestArgs::default().model("gpt-4o").messages(m).build()?`) are the dict of their
 * setters, a message builder's with its role; its configs (`OpenAIConfig::new().with_api_base(u)`) the dict of their
 * `with_*` settings, where the registry reads the base URL.
 */

/** Crates whose `...Args::default()` builders and `...Config::new()` settings are read. */
const SDK_ROOTS = ["async_openai"];
/** openai-api-rs requests built by their constructor: its positional arguments are these fields. */
const CONSTRUCTED: Record<string, string[]> = {
  ChatCompletionRequest: ["model", "messages"],
  CompletionRequest: ["model", "prompt"],
  EmbeddingRequest: ["model", "input"],
  ImageGenerationRequest: ["prompt"],
  ImageEditRequest: ["image", "prompt"],
  ImageVariationRequest: ["image"],
  CreateModerationRequest: ["input"],
  AudioTranscriptionRequest: ["file", "model"],
  AudioSpeechRequest: ["model", "input", "voice", "output"],
  ResponsesRequest: ["model", "input"],
};
const MESSAGE_ROLE = /^ChatCompletionRequest(System|User|Assistant|Developer|Tool|Function)Message(?:Args)?$/;

const str = (v: string): Expr => ({ k: "str", v });

/** Fields set on the variable a value is assigned to, in the same function. */
function laterSets(call: CallExpr, fn: FunctionDef, name: (field: string) => string | undefined): Entry[] {
  const target = fn.assigns.find((a) => a.value === call && !a.edit)?.target;
  if (!target) return [];
  return (fn.attrSets ?? [])
    .filter((s) => s.target === target)
    .flatMap((s): Entry[] => {
      const key = name(s.name);
      return key ? [{ key: str(key), value: s.value, ...(mayNotRun(fn, s.offset, undefined) ? { optional: true } : {}) }] : [];
    });
}

/** How a struct's fields serialize: a project struct by its serde names (skipped fields: none), another as written. */
function namer(cls: ClassDef | undefined): (field: string) => string | undefined {
  if (!cls) return (f) => f;
  return (f) => cls.annotations.find((a) => (a.field ?? a.name) === f)?.name ?? (cls.fieldTypes.has(f) ? undefined : f);
}

function structDict(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped {
  const chain = valueChain(call.fn, fn, ctx);
  const cls = chain.root.kind === "class" ? chain.root.cls : undefined;
  const name = namer(cls);
  const entries: Entry[] = [];
  for (const a of call.args) {
    const key = a.name ? name(a.name) : undefined;
    // `Option<T>` and `skip_serializing_if` fields may be left out
    const optional = !!cls?.annotations.find((x) => x.name === key)?.optional;
    if (key) entries.push({ key: str(key), value: a.value, ...(optional ? { optional } : {}) });
  }
  return { expr: { k: "dict", entries: [...entries, ...laterSets(call, fn, name)] }, fn };
}

interface Setter {
  name: string;
  args: Arg[];
}

/** `x.a(1).b(2)`: the call at its root and the setters called on it, in order. */
function setterChain(e: Expr): { root: Expr; setters: Setter[] } {
  const setters: Setter[] = [];
  let cur = e;
  while (cur.k === "call" && cur.fn.k === "attr" && !["default", "new"].includes(cur.fn.name)) {
    setters.unshift({ name: cur.fn.name, args: cur.args });
    cur = cur.fn.obj;
  }
  return { root: cur, setters };
}

/** The SDK type a `Type::default()` / `Type::new()` call makes, by name: `CreateChatCompletionRequestArgs`. */
function sdkType(root: Expr, fn: FunctionDef, ctx: IrCtx): string | undefined {
  if (root.k !== "call" || root.fn.k !== "attr" || !["default", "new"].includes(root.fn.name)) return undefined;
  const c = valueChain(root.fn.obj, fn, ctx);
  const path = c.root.kind === "external" ? c.segs.map((s) => s.name) : [];
  return path.length > 1 && SDK_ROOTS.includes(path[0]!) ? path.at(-1) : undefined;
}

/** `XArgs::default().a(1).build()`: the dict of the setters; a message's with its role. */
function builderDict(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (call.fn.k !== "attr" || call.args.length > 0) return undefined;
  const { root, setters } = setterChain(call.fn.obj);
  const type = sdkType(root, fn, ctx);
  if (!type?.endsWith("Args")) return undefined;
  const entries: Entry[] = setters.flatMap((s): Entry[] => (s.args[0] ? [{ key: str(s.name), value: s.args[0].value }] : []));
  const role = MESSAGE_ROLE.exec(type)?.[1];
  if (role && !entries.some((e) => e.key?.k === "str" && e.key.v === "role")) entries.unshift({ key: str("role"), value: str(role.toLowerCase()) });
  return { expr: { k: "dict", entries }, fn };
}

/** `OpenAIConfig::new().with_api_base(u).with_api_key(k)`: `{ api_base: u, api_key: k }`. */
function configDict(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  const { root, setters } = setterChain(call);
  if (setters.length === 0 || !setters.every((s) => s.name.startsWith("with_")) || !sdkType(root, fn, ctx)?.endsWith("Config")) return undefined;
  const entries: Entry[] = setters.flatMap((s): Entry[] => (s.args.length === 1 ? [{ key: str(s.name.slice(5)), value: s.args[0]!.value }] : []));
  return { expr: { k: "dict", entries }, fn };
}

/** `ChatCompletionRequestUserMessage::from("...")`: a message with its role and content. */
function messageFrom(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (call.fn.k !== "attr" || call.args.length !== 1) return undefined;
  const c = valueChain(call.fn.obj, fn, ctx);
  const path = c.root.kind === "external" ? c.segs.map((s) => s.name) : [];
  const role = SDK_ROOTS.includes(path[0] ?? "") ? MESSAGE_ROLE.exec(path.at(-1) ?? "")?.[1] : undefined;
  return role ? { expr: { k: "dict", entries: [{ key: str("role"), value: str(role.toLowerCase()) }, { key: str("content"), value: call.args[0]!.value }] }, fn } : undefined;
}

/** `ChatCompletionRequest::new(GPT4_O.to_string(), messages)` (openai-api-rs): its fields, and those set on it afterwards. */
function constructedRequest(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (call.fn.k !== "attr") return undefined;
  const c = valueChain(call.fn.obj, fn, ctx);
  const path = c.root.kind === "external" ? c.segs.map((s) => s.name) : [];
  const fields = path[0] === "openai_api_rs" && Object.hasOwn(CONSTRUCTED, path.at(-1)!) ? CONSTRUCTED[path.at(-1)!]! : undefined;
  if (!fields) return undefined;
  const entries: Entry[] = call.args.flatMap((a, i): Entry[] => (fields[i] && !a.name ? [{ key: str(fields[i]), value: a.value }] : []));
  return { expr: { k: "dict", entries: [...entries, ...laterSets(call, fn, (f) => f)] }, fn };
}

/** A type path (`Settings`, `config::Settings`, `Self`'s type): a name in upper camel case at its end. */
const typePath = (e: Expr): boolean => (e.k === "name" || e.k === "attr" ? /^[A-Z]/.test(e.name) : e.k === "qname" && /^[A-Z]/.test(e.path.at(-1) ?? ""));

/**
 * `Settings::default()`, `Config::new()`: an associated function of the project returning one struct literal stands
 * for it (`self.settings.endpoint` reads the literal's field). Its parameters are not bound: a field set from one is
 * read as that parameter.
 */
function factoryLiteral(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (call.fn.k !== "attr" || !typePath(call.fn.obj)) return undefined;
  const target = calleeChain(call, fn, ctx);
  const made = target.root.kind === "function" && target.segs.length === 0 && target.root.fn.returns.length === 1 ? target.root.fn.returns[0] : undefined;
  return made?.k === "call" && made.isNew && target.root.kind === "function" ? { expr: made, fn: target.root.fn } : undefined;
}

export function rustResolveCall(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (call.isNew) return structDict(call, fn, ctx);
  if (call.fn.k !== "attr") return undefined;
  if (call.fn.name === "build") return builderDict(call, fn, ctx);
  if (call.fn.name.startsWith("with_")) return configDict(call, fn, ctx);
  if (call.fn.name === "from") return messageFrom(call, fn, ctx) ?? factoryLiteral(call, fn, ctx);
  if (call.fn.name === "new") return constructedRequest(call, fn, ctx) ?? factoryLiteral(call, fn, ctx);
  return factoryLiteral(call, fn, ctx);
}
