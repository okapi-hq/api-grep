import type { ConfiguredClient } from "../ir/language.js";
import type { Expr, FunctionDef } from "../ir/model.js";
import { classField, lookup } from "../ir/project.js";
import type { IrCtx } from "../ir/raw.js";
import type { Point } from "./di/collections.js";
import { injectionPoint } from "./di/inject.js";
import { springPropertyText } from "./spring-config.js";

/**
 * Which of several declared Spring AI providers a shared interface (`ChatModel`, `ChatClient`) is (#96): the bean a
 * `@Qualifier("openAiChatModel")` names, the one `spring.ai.model.chat=openai` keeps, or the bean named like the
 * parameter or field (Spring's fallback). Nothing else tells: the call is then left out rather than guessed.
 */

const MAX_STEPS = 6;

const positional = (args: { name?: string; spread?: unknown; value: Expr }[]): Expr[] => args.filter((a) => !a.name && !a.spread).map((a) => a.value);

/** `ChatClient.builder(model)` / `ChatClient.create(model)`: the model; other calls and members: what they are called on. */
function inner(e: Expr): Expr | undefined {
  if (e.k === "call" && e.fn.k === "attr") {
    const args = positional(e.args);
    const owner = e.fn.obj.k === "name" ? e.fn.obj.name : e.fn.obj.k === "attr" ? e.fn.obj.name : "";
    if ((e.fn.name === "builder" || e.fn.name === "create") && owner === "ChatClient" && args.length === 1) return args[0];
    return e.fn.obj;
  }
  return e.k === "attr" && e.obj.k !== "this" ? e.obj : undefined;
}

/** The injection point the client or model of an expression comes from, through locals, fields and `ChatClient.builder(m)`. */
export function sourcePoint(start: Expr, fn: FunctionDef, ctx: IrCtx): Point | undefined {
  let e: Expr = start;
  let scope = fn;
  for (let step = 0; step < MAX_STEPS * 4; step++) {
    const next = inner(e);
    if (next) {
      e = next;
      continue;
    }
    const hit = injectionPoint(e, scope, ctx);
    if (hit) return hit.at;
    const value = valueOf(e, scope, ctx);
    if (!value) return undefined;
    ({ expr: e, fn: scope } = value);
  }
  return undefined;
}

/** The one value a local or a field holds. */
function valueOf(e: Expr, fn: FunctionDef, ctx: IrCtx): { expr: Expr; fn: FunctionDef } | undefined {
  if (e.k === "scoped") return { expr: e.expr, fn: e.fn };
  const name = e.k === "name" ? e.name : e.k === "attr" && e.obj.k === "this" ? e.name : undefined;
  if (!name) return undefined;
  if (e.k === "name") {
    const b = lookup(name, fn, e.pos.offset, ctx.idx);
    if (b.kind === "value") return { expr: b.assign.value, fn: b.fn };
    if (b.kind !== "none" && b.kind !== "external") return undefined;
  }
  const values = fn.cls ? classField(fn.cls, name, ctx.idx) : [];
  if (values.length === 1) return { expr: values[0]!.value, fn: values[0]!.fn };
  // a Java field read by its bare name and injected: the injection point is `this.name`
  return e.k === "name" && fn.cls ? { expr: { k: "attr", obj: { k: "this", pos: e.pos }, name, pos: e.pos }, fn } : undefined;
}

/** `spring.ai.model.<kind>`: the property naming the provider whose model of that kind Spring configures. */
const MODEL_PROPERTY: Record<string, string[]> = {
  chat: ["spring.ai.model.chat"],
  embedding: ["spring.ai.model.embedding.text", "spring.ai.model.embedding"],
  image: ["spring.ai.model.image"],
  transcription: ["spring.ai.model.audio.transcription"],
  speech: ["spring.ai.model.audio.speech"],
};

/** The provider id (`openai`) the configuration keeps for this kind; undefined when it names none or a placeholder. */
function configuredId(kind: string, file: string, ctx: IrCtx): string | undefined {
  if (!ctx.rootDir) return undefined;
  for (const key of MODEL_PROPERTY[kind] ?? []) {
    const v = springPropertyText(file, ctx.rootDir, key)?.trim();
    if (v && !v.includes("${")) return v;
  }
  return undefined;
}

/**
 * Of the declared providers' configurations of one kind, the one the code or the configuration selects; undefined when
 * nothing does.
 */
export function selected(confs: ConfiguredClient[], start: Expr | undefined, fn: FunctionDef, ctx: IrCtx): ConfiguredClient | undefined {
  const point = start ? sourcePoint(start, fn, ctx) : undefined;
  const byBean = (name: string | undefined): ConfiguredClient | undefined => (name ? confs.find((c) => c.bean === name) : undefined);
  const named = point?.quals.find((q) => q.startsWith("named:"))?.slice("named:".length);
  if (point && point.quals.length > 0) return byBean(named);
  const id = configuredId(confs[0]?.kind ?? "", fn.module.file, ctx);
  if (id) return confs.find((c) => c.id === id);
  return byBean(point?.name);
}
