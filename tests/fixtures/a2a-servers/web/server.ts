import express from "express";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import { agentCardHandler, jsonRpcHandler } from "@a2a-js/sdk/server/express";

const card = {
  name: "Shelf keeper",
  supportedInterfaces: [{ url: "https://shelf.example.test/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
  skills: [],
};

const app = express();
app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: async () => card }));
app.use("/a2a", jsonRpcHandler({ requestHandler: undefined as never }));
export { app };
