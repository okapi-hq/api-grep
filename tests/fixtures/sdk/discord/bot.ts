// discord.js calls hang off gateway objects that can't be traced statically: Discord is a host entry
export const postMessage = (channelId: string, content: string) =>
  fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, { method: "POST", headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` }, body: JSON.stringify({ content }) });

export const alert = (content: string) => fetch(process.env.DISCORD_WEBHOOK_URL!, { method: "POST", body: JSON.stringify({ content }) });
