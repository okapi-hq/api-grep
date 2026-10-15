import os
import discord
from discord import app_commands
from discord.ext import commands

intents = discord.Intents.default()
client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)
bot = commands.Bot(command_prefix="!", intents=intents)


@client.event
async def on_ready():
    await tree.sync()


@client.event
async def on_message(message):
    if message.content.startswith("$hello"):
        await message.channel.send("Hello!")


@tree.command(name="ping")
async def ping(interaction: discord.Interaction):
    await interaction.response.send_message("pong", ephemeral=True)
    await interaction.followup.send("again")


@bot.command()
async def hi(ctx: commands.Context):
    await ctx.send("hi there")


async def announce(channel_id: int, text: str):
    channel = client.get_channel(channel_id)
    await channel.send(text)
    user = await client.fetch_user(42)
    return user


async def react(message: discord.Message):
    await message.add_reaction("👍")
    await message.reply("ok")


client.run(os.environ["DISCORD_TOKEN"])
