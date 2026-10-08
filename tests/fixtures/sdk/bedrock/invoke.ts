import { BedrockRuntimeClient, ConverseCommand, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({ region: "us-east-1" });

export async function converse(text: string) {
  return client.send(new ConverseCommand({ modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0", messages: [{ role: "user", content: [{ text }] }] }));
}

export async function invoke(body: string) {
  return client.send(new InvokeModelCommand({ modelId: "amazon.titan-embed-text-v2:0", body, contentType: "application/json" }));
}
