import os
from aiogram import Bot, Dispatcher
from aiogram.types import Message, CallbackQuery

bot = Bot(token=os.environ["BOT_TOKEN"])
dp = Dispatcher()


@dp.message()
async def echo(message: Message) -> None:
    await message.answer("hi")
    await message.answer_photo(photo="https://example.com/a.png", caption="a")


@dp.callback_query()
async def cb(callback: CallbackQuery) -> None:
    await callback.answer("ok", show_alert=True)
    await callback.message.edit_text("edited")


async def broadcast(chat_id: int) -> None:
    await bot.send_message(chat_id, "news")
    await bot.delete_message(chat_id=chat_id, message_id=42)
