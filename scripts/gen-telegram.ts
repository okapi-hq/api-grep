/**
 * Generates the Telegram Bot API registries from one method list (`telegram/methods.ts`) and each library's naming and
 * positional parameters, so every library covers every method:
 *
 *   node-telegram-bot-api  `bot.sendMessage(chatId, text, form)`                     form body
 *   telegraf               `bot.telegram.sendMessage(chatId, text, extra)`, `ctx.reply(text)`    JSON body
 *   grammy                 `bot.api.sendMessage(chat_id, text, other)`, `ctx.reply(text)`      JSON body
 *   python-telegram-bot    `bot.send_message(chat_id, text)`, `context.bot...`, `update.message.reply_text(...)`
 *   aiogram                `bot.send_message(chat_id, text)`, `message.answer(text)`
 *   pyTelegramBotAPI       `bot.send_message(chat_id, text)`, `bot.reply_to(message, text)`   query string
 *   irazasyed/telegram-bot-sdk  `$telegram->sendMessage([...])`, `Telegram::sendMessage([...])`
 *   go-telegram/bot        `b.SendMessage(ctx, &bot.SendMessageParams{...})`        multipart body
 *
 *   pnpm gen:telegram
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IrMethodSpec, IrRegistryEntry } from "../src/lang/ir/language.js";
import type { BodyEncoding, MethodSpec, RegistryEntry } from "../src/types.js";
import { goTelegramBot } from "./telegram/go.js";
import { BOT_API, PATH } from "./telegram/methods.js";
import { GENERATED, pythonEntries } from "./telegram/python.js";
import { GRAMMY_CONTEXT, TELEGRAF_CONTEXT, type Shortcut } from "./telegram/shortcuts.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A method sending `fields` from its positional arguments, then the options object after them. */
export function tsSpec(api: string, fields: string[], encoding?: BodyEncoding): MethodSpec {
  return { method: "POST", path: PATH(api), ...(fields.length > 0 ? { fieldArgs: fields } : {}), bodyArg: fields.length, ...(encoding ? { encoding } : {}) };
}

function tsMethods(prefix: string, fields: Record<string, string[]>, names: Record<string, string>, encoding?: BodyEncoding): Record<string, MethodSpec> {
  const out: Record<string, MethodSpec> = {};
  for (const [api, required] of Object.entries(BOT_API)) out[`${prefix}${api}`] = tsSpec(api, fields[api] ?? required, encoding);
  for (const [alias, api] of Object.entries(names)) out[`${prefix}${alias}`] = tsSpec(api, fields[alias] ?? fields[api] ?? BOT_API[api]!, encoding);
  return out;
}

const shortcuts = (prefix: string, list: Shortcut[]): Record<string, MethodSpec> => Object.fromEntries(list.map(([name, api, fields]) => [`${prefix}${name}`, tsSpec(api, fields)]));

const BASE = { provider: "telegram", host: "api.telegram.org", auth: "apikey" as const, generatedFrom: GENERATED };

type Commented<T> = T & { $comment: string };

function nodeTelegramBotApi(): Commented<RegistryEntry> {
  const fields: Record<string, string[]> = {
    getUpdates: [],
    editMessageText: ["text"],
    editMessageCaption: ["caption"],
    editMessageReplyMarkup: ["reply_markup"],
    editMessageMedia: ["media"],
    editMessageLiveLocation: ["latitude", "longitude"],
    setChatDescription: ["chat_id", "description"],
    sendInvoice: ["chat_id", "title", "description", "payload", "provider_token", "currency", "prices"],
  };
  const names = { setWebHook: "setWebhook", deleteWebHook: "deleteWebhook", getWebHookInfo: "getWebhookInfo" };
  return {
    ...BASE,
    package: "node-telegram-bot-api",
    $comment: `\`new TelegramBot(token)\`: \`bot.sendMessage(chatId, text, form)\` posts its arguments as a form (multipart with a file).`,
    instance: { names: ["default", "TelegramBot"] },
    methods: tsMethods("", fields, names, "form"),
  };
}

function telegraf(): Commented<RegistryEntry> {
  const chatMessage = ["chat_id", "message_id", "inline_message_id"];
  const fields: Record<string, string[]> = {
    getUpdates: ["timeout", "limit", "offset", "allowed_updates"],
    editMessageText: [...chatMessage, "text"],
    editMessageCaption: [...chatMessage, "caption"],
    editMessageMedia: [...chatMessage, "media"],
    editMessageReplyMarkup: [...chatMessage, "reply_markup"],
    editMessageLiveLocation: [...chatMessage, "latitude", "longitude"],
    stopMessageLiveLocation: [...chatMessage, "reply_markup"],
    banChatMember: ["chat_id", "user_id", "until_date"],
    kickChatMember: ["chat_id", "user_id", "until_date"],
    unpinChatMessage: ["chat_id", "message_id"],
    getUserProfilePhotos: ["user_id", "offset", "limit"],
    setMessageReaction: ["chat_id", "message_id", "reaction", "is_big"],
    setChatDescription: ["chat_id", "description"],
    sendInvoice: ["chat_id"],
    createInvoiceLink: [],
    answerCbQuery: ["callback_query_id", "text"],
  };
  const methods = { ...tsMethods("telegram.", fields, { answerCbQuery: "answerCallbackQuery" }), ...shortcuts("ctx.", TELEGRAF_CONTEXT) };
  methods["telegram.callApi"] = { method: "POST", path: PATH("{method}"), params: { method: "arg:0" }, bodyArg: 1 };
  return {
    ...BASE,
    package: "telegraf",
    $comment: `\`new Telegraf(token)\`: \`bot.telegram.sendMessage(chatId, text, extra)\` (also \`ctx.telegram\`) and the handler context's \`ctx.reply(text, extra)\`, JSON bodies (multipart with a file).`,
    instance: { names: ["Telegraf"] },
    contextClients: ["ctx", "telegram"],
    methods,
  };
}

function grammy(): Commented<RegistryEntry> {
  const fields: Record<string, string[]> = {
    getUpdates: [],
    editMessageText: ["chat_id", "message_id", "text"],
    editMessageCaption: ["chat_id", "message_id"],
    editMessageMedia: ["chat_id", "message_id", "media"],
    editMessageReplyMarkup: ["chat_id", "message_id"],
    editMessageLiveLocation: ["chat_id", "message_id", "latitude", "longitude"],
    stopMessageLiveLocation: ["chat_id", "message_id"],
    editMessageTextInline: ["inline_message_id", "text"],
    editMessageCaptionInline: ["inline_message_id"],
    editMessageMediaInline: ["inline_message_id", "media"],
    editMessageReplyMarkupInline: ["inline_message_id"],
  };
  const inline = { editMessageTextInline: "editMessageText", editMessageCaptionInline: "editMessageCaption", editMessageMediaInline: "editMessageMedia", editMessageReplyMarkupInline: "editMessageReplyMarkup" };
  const raw = Object.fromEntries(Object.keys(BOT_API).map((api) => [`api.raw.${api}`, { method: "POST", path: PATH(api), bodyArg: 0 }]));
  return {
    ...BASE,
    package: "grammy",
    $comment: `\`new Bot(token)\`: \`bot.api.sendMessage(chat_id, text, other)\` (also \`ctx.api\`, and \`api.raw\` with one object) and the handler context's \`ctx.reply(text, other)\`, JSON bodies (multipart with a file).`,
    instance: { names: ["Bot", "Api"] },
    contextClients: ["ctx", "api"],
    methods: { ...tsMethods("api.", fields, inline), ...raw, ...shortcuts("ctx.", GRAMMY_CONTEXT) },
  };
}

function telegramBotSdk(): Commented<IrRegistryEntry> {
  const methods: Record<string, IrMethodSpec> = {};
  for (const api of Object.keys(BOT_API)) methods[api] = { method: "POST", path: PATH(api), bodyArg: 0, encoding: "form" };
  methods.removeWebhook = { method: "POST", path: PATH("deleteWebhook"), encoding: "form" };
  return {
    ...BASE,
    package: "irazasyed/telegram-bot-sdk",
    imports: ["Telegram", "Telegram.Bot", "Telegram.Bot.Laravel.Facades.Telegram"],
    $comment: `\`(new Api($token))->sendMessage(['chat_id' => ..., 'text' => ...])\` and the Laravel facade \`Telegram::sendMessage([...])\` (also \`Telegram::bot('name')->...\`): a form body (multipart with a file).`,
    instance: { names: ["Api", "BotsManager"] },
    builders: ["bot"],
    methods,
  };
}

const ORDER = ["$comment", "package", "aliases", "imports", "provider", "host", "auth", "generatedFrom", "instance", "contextClients", "builders", "methods"];
const rank = (key: string): number => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);
/** One line, spaced like the hand-written registries: `{"method": "POST", "path": "/x"}`. */
const compact = (v: unknown): string =>
  JSON.stringify(v, null, 1)
    .replace(/\n\s*/g, " ")
    .replace(/([[{]) /g, "$1")
    .replace(/ ([\]}])/g, "$1");

/** Methods one per line, the rest indented: the layout of the hand-written registries. */
function serialize(entry: object): string {
  const lines: string[] = [];
  const write = (e: object, indent: string): void => {
    const keys = Object.entries(e).sort(([a], [b]) => rank(a) - rank(b));
    lines.push(`${indent}{`);
    keys.forEach(([k, v], i) => {
      const comma = i < keys.length - 1 ? "," : "";
      if (k !== "methods") return lines.push(`${indent}  ${JSON.stringify(k)}: ${compact(v)}${comma}`);
      const methods = Object.entries(v as Record<string, unknown>);
      lines.push(`${indent}  "methods": {`);
      methods.forEach(([m, spec], j) => lines.push(`${indent}    ${JSON.stringify(m)}: ${compact(spec)}${j < methods.length - 1 ? "," : ""}`));
      lines.push(`${indent}  }${comma}`);
    });
    lines.push(`${indent}}`);
  };
  if (!Array.isArray(entry)) write(entry, "");
  else {
    lines.push("[");
    entry.forEach((e: object, i) => {
      write(e, "  ");
      if (i < entry.length - 1) lines[lines.length - 1] += ",";
    });
    lines.push("]");
  }
  return `${lines.join("\n")}\n`;
}

function save(rel: string, entry: object): void {
  writeFileSync(path.join(root, rel), serialize(entry));
  process.stdout.write(`wrote ${rel}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  save("src/detect/registry/node-telegram-bot-api.json", nodeTelegramBotApi());
  save("src/detect/registry/telegraf.json", telegraf());
  save("src/detect/registry/grammy.json", grammy());
  save("src/lang/php/registry/telegram-bot-sdk.json", telegramBotSdk());
  for (const [file, entries] of Object.entries(pythonEntries())) save(`src/lang/python/registry/${file}.json`, entries);
  save("src/lang/go/registry/go-telegram-bot.json", goTelegramBot());
}
