export function reply(client: any, prompt: string) {
  return client.chat.completions.create({ model: "some-model", messages: [{ role: "user", content: prompt }] });
}
