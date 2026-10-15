/**
 * Methods of the objects a Telegram library hands to update handlers, which send a Bot API request for the chat or
 * the message they belong to: `[name, Bot API method, positional parameters]` (the chat id comes from the object).
 */
export type Shortcut = [string, string, string[]];

const media = (prefix: string, style: "snake" | "camel"): Shortcut[] =>
  [
    ["photo", "sendPhoto"],
    ["document", "sendDocument"],
    ["video", "sendVideo"],
    ["audio", "sendAudio"],
    ["voice", "sendVoice"],
    ["animation", "sendAnimation"],
    ["sticker", "sendSticker"],
    ["video_note", "sendVideoNote"],
    ["media_group", "sendMediaGroup"],
  ].map(([kind, api]) => {
    const field = kind === "media_group" ? "media" : kind!;
    const name = style === "snake" ? `${prefix}_${kind}` : `${prefix}${kind!.replace(/(^|_)([a-z])/g, (_, _s: string, c: string) => c.toUpperCase())}`;
    return [name, api!, [field]];
  });

/** python-telegram-bot's `Message` (`update.message.reply_text("hi")`). */
export const PTB_MESSAGE: Shortcut[] = [
  ["reply_text", "sendMessage", ["text"]],
  ["reply_html", "sendMessage", ["text"]],
  ["reply_markdown", "sendMessage", ["text"]],
  ["reply_markdown_v2", "sendMessage", ["text"]],
  ...media("reply", "snake"),
  ["reply_location", "sendLocation", ["latitude", "longitude"]],
  ["reply_poll", "sendPoll", ["question", "options"]],
  ["reply_dice", "sendDice", []],
  ["reply_chat_action", "sendChatAction", ["action"]],
  ["edit_text", "editMessageText", ["text"]],
  ["edit_caption", "editMessageCaption", ["caption"]],
  ["edit_reply_markup", "editMessageReplyMarkup", ["reply_markup"]],
  ["edit_media", "editMessageMedia", ["media"]],
  ["delete", "deleteMessage", []],
  ["forward", "forwardMessage", ["chat_id"]],
  ["copy", "copyMessage", ["chat_id"]],
  ["pin", "pinChatMessage", []],
  ["unpin", "unpinChatMessage", []],
  ["set_reaction", "setMessageReaction", ["reaction"]],
  ["stop_poll", "stopPoll", []],
];

/** python-telegram-bot's `CallbackQuery` (`await query.answer()`). */
export const PTB_CALLBACK: Shortcut[] = [
  ["answer", "answerCallbackQuery", ["text"]],
  ["edit_message_text", "editMessageText", ["text"]],
  ["edit_message_caption", "editMessageCaption", ["caption"]],
  ["edit_message_reply_markup", "editMessageReplyMarkup", ["reply_markup"]],
  ["edit_message_media", "editMessageMedia", ["media"]],
  ["delete_message", "deleteMessage", []],
  ["pin_message", "pinChatMessage", []],
  ["unpin_message", "unpinChatMessage", []],
  ["copy_message", "copyMessage", ["chat_id"]],
];

/** python-telegram-bot's `Chat` and `User` (`update.effective_chat.send_message("hi")`). */
export const PTB_CHAT: Shortcut[] = [
  ["send_message", "sendMessage", ["text"]],
  ...media("send", "snake"),
  ["send_location", "sendLocation", ["latitude", "longitude"]],
  ["send_poll", "sendPoll", ["question", "options"]],
  ["send_action", "sendChatAction", ["action"]],
  ["send_chat_action", "sendChatAction", ["action"]],
  ["leave", "leaveChat", []],
  ["get_member", "getChatMember", ["user_id"]],
  ["get_administrators", "getChatAdministrators", []],
  ["ban_member", "banChatMember", ["user_id"]],
  ["unban_member", "unbanChatMember", ["user_id"]],
  ["pin_message", "pinChatMessage", ["message_id"]],
];

/** aiogram 3's `Message` (`await message.answer("hi")`). */
export const AIOGRAM_MESSAGE: Shortcut[] = [
  ["answer", "sendMessage", ["text"]],
  ["reply", "sendMessage", ["text"]],
  ...media("answer", "snake"),
  ...media("reply", "snake"),
  ["answer_location", "sendLocation", ["latitude", "longitude"]],
  ["answer_venue", "sendVenue", ["latitude", "longitude", "title", "address"]],
  ["answer_contact", "sendContact", ["phone_number", "first_name"]],
  ["answer_poll", "sendPoll", ["question", "options"]],
  ["answer_dice", "sendDice", []],
  ["answer_invoice", "sendInvoice", ["title", "description", "payload", "currency", "prices"]],
  ["edit_text", "editMessageText", ["text"]],
  ["edit_caption", "editMessageCaption", []],
  ["edit_reply_markup", "editMessageReplyMarkup", []],
  ["delete_reply_markup", "editMessageReplyMarkup", []],
  ["edit_media", "editMessageMedia", ["media"]],
  ["edit_live_location", "editMessageLiveLocation", ["latitude", "longitude"]],
  ["delete", "deleteMessage", []],
  ["forward", "forwardMessage", ["chat_id"]],
  ["copy_to", "copyMessage", ["chat_id"]],
  ["pin", "pinChatMessage", []],
  ["unpin", "unpinChatMessage", []],
  ["react", "setMessageReaction", ["reaction"]],
];

/** aiogram 3's `CallbackQuery` (`await callback.answer()`). */
export const AIOGRAM_CALLBACK: Shortcut[] = [["answer", "answerCallbackQuery", ["text"]]];

/** The context of telegraf and grammY handlers (`ctx.reply("hi")`), the parts both libraries name alike. */
const CONTEXT: Shortcut[] = [
  ["reply", "sendMessage", ["text"]],
  ...media("replyWith", "camel"),
  ["replyWithLocation", "sendLocation", ["latitude", "longitude"]],
  ["replyWithVenue", "sendVenue", ["latitude", "longitude", "title", "address"]],
  ["replyWithContact", "sendContact", ["phone_number", "first_name"]],
  ["replyWithPoll", "sendPoll", ["question", "options"]],
  ["editMessageText", "editMessageText", ["text"]],
  ["editMessageMedia", "editMessageMedia", ["media"]],
  ["answerInlineQuery", "answerInlineQuery", ["results"]],
  ["forwardMessage", "forwardMessage", ["chat_id"]],
  ["copyMessage", "copyMessage", ["chat_id"]],
  ["pinChatMessage", "pinChatMessage", ["message_id"]],
  ["unpinChatMessage", "unpinChatMessage", ["message_id"]],
  ["leaveChat", "leaveChat", []],
  ["getChat", "getChat", []],
  ["getChatMember", "getChatMember", ["user_id"]],
  ["getChatAdministrators", "getChatAdministrators", []],
  ["banChatMember", "banChatMember", ["user_id"]],
  ["unbanChatMember", "unbanChatMember", ["user_id"]],
  ["setMessageReaction", "setMessageReaction", ["reaction"]],
  ["react", "setMessageReaction", ["reaction"]],
];

/** telegraf 4's `Context`. */
export const TELEGRAF_CONTEXT: Shortcut[] = [
  ...CONTEXT,
  ["replyWithHTML", "sendMessage", ["text"]],
  ["replyWithMarkdown", "sendMessage", ["text"]],
  ["replyWithMarkdownV2", "sendMessage", ["text"]],
  ["sendMessage", "sendMessage", ["text"]],
  ...media("send", "camel"),
  ["replyWithQuiz", "sendPoll", ["question", "options"]],
  ["replyWithDice", "sendDice", []],
  ["replyWithInvoice", "sendInvoice", []],
  ["replyWithChatAction", "sendChatAction", ["action"]],
  ["sendChatAction", "sendChatAction", ["action"]],
  ["editMessageCaption", "editMessageCaption", ["caption"]],
  ["editMessageReplyMarkup", "editMessageReplyMarkup", ["reply_markup"]],
  ["deleteMessage", "deleteMessage", ["message_id"]],
  ["answerCbQuery", "answerCallbackQuery", ["text"]],
  ["answerCallbackQuery", "answerCallbackQuery", ["text"]],
];

/** grammY's `Context`. */
export const GRAMMY_CONTEXT: Shortcut[] = [
  ...CONTEXT,
  ["replyWithDice", "sendDice", ["emoji"]],
  ["replyWithInvoice", "sendInvoice", ["title", "description", "payload", "currency", "prices"]],
  ["replyWithChatAction", "sendChatAction", ["action"]],
  ["editMessageCaption", "editMessageCaption", []],
  ["editMessageReplyMarkup", "editMessageReplyMarkup", []],
  ["deleteMessage", "deleteMessage", []],
  ["answerCallbackQuery", "answerCallbackQuery", []],
  ["getFile", "getFile", []],
];
