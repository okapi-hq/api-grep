import { Bot } from "grammy";

const bot = new Bot(process.env.BOT_TOKEN!);

bot.command("start", (ctx) => ctx.reply("Hi!"));
bot.on("message", async (ctx) => {
  await ctx.api.sendChatAction(ctx.chat.id, "typing");
  await ctx.react("👍");
});

export const send = (chatId: number, text: string) => bot.api.sendMessage(chatId, text);
export const remove = (chatId: number, id: number) => bot.api.deleteMessage(chatId, id);
