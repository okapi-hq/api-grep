import { Telegraf } from "telegraf";

const bot = new Telegraf(process.env.BOT_TOKEN!);

bot.start((ctx) => ctx.reply("Welcome"));
bot.command("photo", (ctx) => ctx.replyWithPhoto({ url: "https://example.com/p.png" }, { caption: "p" }));
bot.on("callback_query", async (ctx) => {
  await ctx.answerCbQuery("ok");
  await ctx.telegram.sendMessage(ctx.chat!.id, "done");
});

export async function notify(chatId: number) {
  await bot.telegram.sendMessage(chatId, "hello", { parse_mode: "MarkdownV2" });
}
