const { Client, GatewayIntentBits, Events } = require("discord.js");

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.on(Events.MessageCreate, async (message) => {
  if (message.content === "!ping") await message.reply("Pong!");
  await message.react("👍");
  await message.channel.send({ content: "hello" });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply({ content: "done" });
  const members = await interaction.guild.members.fetch();
  return members;
});

async function announce(channelId, text) {
  const channel = await client.channels.fetch(channelId);
  await channel.send(text);
}

client.login(process.env.DISCORD_TOKEN);
module.exports = { announce };
