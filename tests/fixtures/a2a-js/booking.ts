import { A2AClient } from "@a2a-js/sdk/client";
import { ClientFactory } from "@a2a-js/sdk/client";

const RECEPTION = "https://reception.lantern-inn.dev";

export async function book(message: { role: "user"; parts: { kind: "text"; text: string }[]; messageId: string }) {
  const factory = new ClientFactory();
  const client = await factory.createFromUrl(RECEPTION);
  const result = await client.sendMessage({ message });
  return client.getTask({ id: "t-1" }).then(() => result);
}

export async function legacy(text: string) {
  const client = await A2AClient.fromCardUrl("https://rooms.lantern-inn.dev/.well-known/agent-card.json");
  for await (const event of client.sendMessageStream({ message: { kind: "message", role: "user", messageId: "m-1", parts: [{ kind: "text", text }] } })) {
    console.log(event);
  }
  await client.cancelTask({ id: "t-2" });
}
