const { A2AClient, ClientFactory, DefaultAgentCardResolver } = require("@a2a-js/sdk/client");

async function concierge() {
  const client = new A2AClient("https://concierge.lantern-inn.dev/.well-known/agent-card.json");
  return client.sendMessage({ message: { kind: "message", role: "user", messageId: "m-2", parts: [] } });
}

async function viaResolver() {
  const resolver = new DefaultAgentCardResolver();
  const card = await resolver.resolve("https://kitchen.lantern-inn.dev");
  const client = await new ClientFactory().createFromAgentCard(card);
  return client.listTasks({});
}

module.exports = { concierge, viaResolver };
