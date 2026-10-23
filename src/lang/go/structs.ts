import { valueChain } from "../ir/chain.js";
import { mayNotRun } from "../ir/edits.js";
import type { Scoped } from "../ir/language.js";
import type { CallExpr, ClassDef, Entry, Expr, FunctionDef } from "../ir/model.js";
import type { IrCtx } from "../ir/raw.js";
import { EXTRAS, importRoot } from "./names.js";

/**
 * Go's `resolveCall`: a struct literal is the dict it serializes to (a project struct by its JSON tags, an SDK's
 * request struct by the SDK's naming: `MaxTokens` -> `max_tokens`), with the fields set on its variable afterwards
 * (`req.Stream = true`); SDK helpers stand for what they build (`openai.UserMessage(m)`, `openai.DefaultConfig(k)`).
 */

type Helper = "config" | "text-block" | "contents" | "part" | { role: string; list?: boolean };

interface SdkStructs {
  roots: string[];
  case: "snake" | "camel";
  helpers: Record<string, Helper>;
  /** Fields whose `json` tag is not their name in `case` (`GameShorName` -> `game_short_name`, `VCard` -> `vcard`). */
  renames?: Record<string, string>;
}

const TABLE: SdkStructs[] = [
  { roots: ["github.com/sashabaranov/go-openai"], case: "snake", helpers: { DefaultConfig: "config", DefaultAzureConfig: "config" } },
  {
    roots: ["github.com/openai/openai-go"],
    case: "snake",
    helpers: { UserMessage: { role: "user" }, SystemMessage: { role: "system" }, AssistantMessage: { role: "assistant" }, DeveloperMessage: { role: "developer" } },
  },
  {
    roots: ["github.com/anthropics/anthropic-sdk-go"],
    case: "snake",
    helpers: { NewUserMessage: { role: "user", list: true }, NewAssistantMessage: { role: "assistant", list: true }, NewTextBlock: "text-block" },
  },
  { roots: ["google.golang.org/genai"], case: "camel", helpers: { Text: "contents", NewPartFromText: "part" } },
  { roots: ["github.com/go-telegram/bot"], case: "snake", helpers: {}, renames: { GameShorName: "game_short_name", VCard: "vcard" } },
];

const SDKS = TABLE.map((s) => ({ ...s, roots: s.roots.map(importRoot) }));

/**
 * `MaxTokens` -> `max_tokens`, `ToolCallID` -> `tool_call_id`, `MessageIDs` -> `message_ids`; `camel`:
 * `MaxOutputTokens` -> `maxOutputTokens`.
 */
export function fieldKey(name: string, style: "snake" | "camel"): string {
  if (style === "camel") return name.replace(/^[A-Z]+(?=[A-Z][a-z]|$)|^[A-Z]/, (m) => m.toLowerCase());
  return name
    .replace(/IDs(?=[A-Z]|$)/g, "Ids")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/** The SDK an external path is under (`[github_com, openai, openai-go, v3, ChatCompletionNewParams]`), and the rest. */
function sdkOf(path: string[]): { sdk: SdkStructs; name: string } | undefined {
  const joined = path.join(".");
  for (const sdk of SDKS) {
    const root = sdk.roots.find((r) => joined.startsWith(`${r}.`));
    if (root) return { sdk, name: path.at(-1)! };
  }
  return undefined;
}

type Namer = (goName: string) => string | undefined;

/** How a struct's fields are named in its JSON: a project struct by its tags, an SDK's by its convention. */
function namerFor(call: CallExpr, fn: FunctionDef, ctx: IrCtx): { name: Namer; cls?: ClassDef } {
  const chain = valueChain(call.fn, fn, ctx);
  if (chain.root.kind === "class") {
    const cls = chain.root.cls;
    return { cls, name: (goName) => cls.annotations.find((a) => (a.field ?? a.name) === goName)?.name ?? goName };
  }
  const sdk = chain.root.kind === "external" ? sdkOf(chain.segs.map((s) => s.name)) : undefined;
  const renames = sdk?.sdk.renames ?? {};
  return { name: (goName) => (sdk ? (Object.hasOwn(renames, goName) ? renames[goName]! : fieldKey(goName, sdk.sdk.case)) : goName) };
}

/** Fields set on the variable a value is assigned to (`req.MaxTokens = 100`), in the same function. */
function laterSets(call: CallExpr, fn: FunctionDef, name: Namer): Entry[] {
  const target = fn.assigns.find((a) => a.value === call && !a.edit)?.target;
  if (!target) return [];
  return (fn.attrSets ?? [])
    .filter((s) => s.target === target)
    .flatMap((s): Entry[] => {
      const key = name(s.name);
      return key ? [{ key: { k: "str", v: key }, value: s.value, ...(mayNotRun(fn, s.offset, undefined) ? { optional: true } : {}) }] : [];
    });
}

function structDict(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped {
  const { name, cls } = namerFor(call, fn, ctx);
  const order = cls ? (EXTRAS.get(cls.module)?.order.get(cls) ?? []) : [];
  const entries: Entry[] = [];
  call.args.forEach((a, i) => {
    const goName = a.name ?? order[i];
    const key = goName ? name(goName) : undefined;
    if (key && !a.spread) entries.push({ key: { k: "str", v: key }, value: a.value });
  });
  return { expr: { k: "dict", entries: [...entries, ...laterSets(call, fn, name)] }, fn };
}

const str = (v: string): Expr => ({ k: "str", v });
const entry = (k: string, value: Expr): Entry => ({ key: str(k), value });

function helperValue(helper: Helper, call: CallExpr, fn: FunctionDef): Expr | undefined {
  const args = call.args.filter((a) => !a.name);
  const first = args[0]?.value;
  // `cfg := openai.DefaultConfig(key); cfg.BaseURL = u`: the base URL set on it, or the one the Azure config is given
  if (helper === "config") return { k: "dict", entries: [...(args[1] ? [entry("BaseURL", args[1].value)] : []), ...laterSets(call, fn, (n) => n)] };
  if (!first) return undefined;
  if (helper === "text-block") return { k: "dict", entries: [entry("type", str("text")), entry("text", first)] };
  if (helper === "part") return { k: "dict", entries: [entry("text", first)] };
  if (helper === "contents") return { k: "list", items: [{ k: "dict", entries: [entry("role", str("user")), entry("parts", { k: "list", items: [{ k: "dict", entries: [entry("text", first)] }] })] }] };
  const content = helper.list ? { k: "list" as const, items: args.map((a) => a.value) } : first;
  return { k: "dict", entries: [entry("role", str(helper.role)), entry("content", content)] };
}

/** An SDK helper building a value (`openai.UserMessage(m)`), when the call is one. */
function sdkHelper(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (call.fn.k !== "attr" || !/^[A-Z]/.test(call.fn.name)) return undefined;
  const chain = valueChain(call.fn, fn, ctx);
  const hit = chain.root.kind === "external" ? sdkOf(chain.segs.map((s) => s.name)) : undefined;
  const helper = hit && Object.hasOwn(hit.sdk.helpers, hit.name) ? hit.sdk.helpers[hit.name]! : undefined;
  const value = helper ? helperValue(helper, call, fn) : undefined;
  return value ? { expr: value, fn } : undefined;
}

export function goResolveCall(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  return call.isNew ? structDict(call, fn, ctx) : sdkHelper(call, fn, ctx);
}
