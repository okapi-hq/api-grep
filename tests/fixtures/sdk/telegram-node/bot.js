const TelegramBot = require("node-telegram-bot-api");

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

bot.on("message", (msg) => {
  bot.sendMessage(msg.chat.id, "Received", { parse_mode: "HTML" });
});

bot.onText(/\/photo/, (msg) => {
  bot.sendPhoto(msg.chat.id, "https://example.com/cat.png", { caption: "cat" });
});

module.exports.edit = (text, chatId, messageId) => bot.editMessageText(text, { chat_id: chatId, message_id: messageId });
module.exports.hook = () => bot.setWebHook("https://example.com/hook");
