import os
from telegram import Update, Bot
from telegram.ext import Application, CommandHandler, ContextTypes

TOKEN = os.environ["TELEGRAM_TOKEN"]


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text("Hello!")
    await context.bot.send_message(chat_id=update.effective_chat.id, text="Welcome", parse_mode="HTML")


async def button(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(text="Done")


async def untyped(update, context):
    await context.bot.send_photo(update.effective_chat.id, photo="https://example.com/cat.png")


async def notify(chat_id: int) -> None:
    bot = Bot(TOKEN)
    await bot.send_message(chat_id, "ping")


def main() -> None:
    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.bot.set_my_commands([("start", "Start")])
    app.run_polling()
