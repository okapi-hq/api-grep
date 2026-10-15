import type { IrMethodSpec, IrRegistryEntry } from "../../src/lang/ir/language.js";
import { BOT_API, PATH, snake } from "./methods.js";
import { AIOGRAM_CALLBACK, AIOGRAM_MESSAGE, PTB_CALLBACK, PTB_CHAT, PTB_MESSAGE, type Shortcut } from "./shortcuts.js";

export const GENERATED = "pnpm gen:telegram (scripts/gen-telegram.ts: the Bot API method list and each library's signatures); do not edit by hand";

type Entry = IrRegistryEntry & { $comment?: string };
type Transport = "body" | "query";

/** Keyword arguments and the positional `fields` as the body (or the query string, pyTelegramBotAPI). */
function pySpec(api: string, fields: string[], transport: Transport = "body"): IrMethodSpec {
  const verb = transport === "query" && api.startsWith("get") ? "GET" : "POST";
  return {
    method: verb,
    path: PATH(api),
    ...(fields.length > 0 ? { fieldArgs: fields } : {}),
    ...(transport === "query" ? { queryKwargs: true } : { bodyKwargs: true, encoding: "form" as const }),
  };
}

function botMethods(prefix: string, fields: Record<string, string[]>, transport?: Transport): Record<string, IrMethodSpec> {
  return Object.fromEntries(Object.entries(BOT_API).map(([api, required]) => [`${prefix}${snake(api)}`, pySpec(api, fields[api] ?? required, transport)]));
}

const shortcutMethods = (prefixes: string[], list: Shortcut[]): Record<string, IrMethodSpec> =>
  Object.fromEntries(prefixes.flatMap((p) => list.map(([name, api, fields]) => [`${p}${name}`, pySpec(api, fields)])));

const BASE = { provider: "telegram", host: "api.telegram.org", auth: "apikey" as const, generatedFrom: GENERATED };

/** python-telegram-bot 20+: the bot, what holds it, and the objects handlers get. */
function pythonTelegramBot(): Entry[] {
  const base = { ...BASE, package: "python-telegram-bot", imports: ["telegram"] };
  const fields: Record<string, string[]> = {
    getUpdates: ["offset", "limit", "timeout"],
    editMessageText: ["text", "chat_id", "message_id", "inline_message_id"],
    editMessageCaption: ["chat_id", "message_id", "inline_message_id", "caption"],
    editMessageReplyMarkup: ["chat_id", "message_id", "inline_message_id", "reply_markup"],
    editMessageLiveLocation: [],
    sendInvoice: ["chat_id", "title", "description", "payload"],
    createInvoiceLink: ["title", "description", "payload"],
  };
  const messages = ["message.", "effective_message.", "edited_message.", "channel_post.", "callback_query.message."];
  return [
    {
      $comment:
        "python-telegram-bot: `Bot(token).send_message(chat_id, text)` posts its arguments as a form (multipart with a file); `context.bot` in a handler (`ContextTypes.DEFAULT_TYPE`, `CallbackContext`) and `application.bot` are that bot. The objects handlers get send requests of their own: `update.message.reply_text(text)` is `sendMessage` to the message's chat, `query.answer()` is `answerCallbackQuery`.",
      ...base,
      instance: { names: ["Bot", "ExtBot", "ext.ExtBot"] },
      methods: botMethods("", fields),
    },
    {
      ...base,
      instance: { names: ["ext.ContextTypes.DEFAULT_TYPE", "ext.CallbackContext", "ext.Application", "ext.Application.builder", "ext.ApplicationBuilder"], build: "build" },
      methods: botMethods("bot.", fields),
    },
    {
      ...base,
      instance: { names: ["Update"] },
      methods: { ...shortcutMethods(messages, PTB_MESSAGE), ...shortcutMethods(["callback_query."], PTB_CALLBACK), ...shortcutMethods(["effective_chat.", "effective_user."], PTB_CHAT) },
    },
    { ...base, instance: { names: ["Message"] }, methods: shortcutMethods([""], PTB_MESSAGE) },
    { ...base, instance: { names: ["CallbackQuery"] }, methods: { ...shortcutMethods([""], PTB_CALLBACK), ...shortcutMethods(["message."], PTB_MESSAGE) } },
    { ...base, instance: { names: ["Chat", "User"] }, methods: shortcutMethods([""], PTB_CHAT) },
  ];
}

/** aiogram 3: methods take the API's required parameters first, in its order. */
function aiogram(): Entry[] {
  const base = { ...BASE, package: "aiogram", imports: ["aiogram"] };
  return [
    {
      $comment:
        "aiogram 3: `Bot(token).send_message(chat_id, text)` posts its arguments as a form (multipart with a file). The objects handlers get send requests of their own: `message.answer(text)` is `sendMessage` to the message's chat, `callback.answer()` is `answerCallbackQuery`.",
      ...base,
      instance: { names: ["Bot", "client.bot.Bot"] },
      methods: botMethods("", {}),
    },
    { ...base, instance: { names: ["types.Message", "types.message.Message"] }, methods: shortcutMethods([""], AIOGRAM_MESSAGE) },
    {
      ...base,
      instance: { names: ["types.CallbackQuery", "types.callback_query.CallbackQuery"] },
      methods: { ...shortcutMethods([""], AIOGRAM_CALLBACK), ...shortcutMethods(["message."], AIOGRAM_MESSAGE) },
    },
  ];
}

/** pyTelegramBotAPI: the parameters go in the query string, `get*` methods as a GET. */
function pyTelegramBotApi(): Entry {
  const fields: Record<string, string[]> = {
    getUpdates: ["offset", "limit", "timeout"],
    editMessageText: ["text", "chat_id", "message_id", "inline_message_id"],
    editMessageCaption: ["caption", "chat_id", "message_id", "inline_message_id"],
    editMessageReplyMarkup: ["chat_id", "message_id", "inline_message_id", "reply_markup"],
    editMessageMedia: ["media", "chat_id", "message_id", "inline_message_id"],
    editMessageLiveLocation: ["latitude", "longitude", "chat_id", "message_id"],
    answerCallbackQuery: ["callback_query_id", "text", "show_alert"],
    sendInvoice: ["chat_id", "title", "description", "payload", "provider_token", "currency", "prices"],
  };
  const methods = botMethods("", fields, "query");
  methods.reply_to = pySpec("sendMessage", ["", "text"], "query");
  return {
    $comment:
      "pyTelegramBotAPI (`telebot`): `TeleBot(token).send_message(chat_id, text)` sends its arguments in the query string (a multipart body with a file), `get*` methods as a GET; `bot.reply_to(message, text)` is `sendMessage` to the message's chat. `AsyncTeleBot` has the same methods.",
    ...BASE,
    package: "pyTelegramBotAPI",
    imports: ["telebot"],
    instance: { names: ["TeleBot", "async_telebot.AsyncTeleBot"] },
    methods,
  };
}

/** Registry file name -> its entries. */
export function pythonEntries(): Record<string, Entry | Entry[]> {
  return { "python-telegram-bot": pythonTelegramBot(), aiogram: aiogram(), pytelegrambotapi: pyTelegramBotApi() };
}
