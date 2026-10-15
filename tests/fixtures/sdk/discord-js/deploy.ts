import { REST, Routes } from "discord.js";

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!);

export async function deploy(clientId: string, guildId: string, commands: unknown[]) {
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  const route = Routes.channelMessages("123");
  await rest.post(route, { body: { content: "hi" } });
  return rest.get(`/users/@me`);
}
