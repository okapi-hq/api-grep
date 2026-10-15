import os
import telebot

bot = telebot.TeleBot(os.environ["TOKEN"])


@bot.message_handler(commands=["start"])
def start(message):
    bot.reply_to(message, "Howdy")
    bot.send_message(message.chat.id, "hello", parse_mode="Markdown")
    bot.get_me()
