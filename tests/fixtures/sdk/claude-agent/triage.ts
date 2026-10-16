import { query } from "@anthropic-ai/claude-agent-sdk";

export async function triage(issue: string) {
  for await (const message of query({ prompt: `Label this issue: ${issue}`, options: { model: "claude-haiku-4-5", maxTurns: 2 } })) {
    if (message.type === "result") return message;
  }
  return undefined;
}

const options = { model: "claude-opus-4-1", allowedTools: ["Read"] };

export const plan = (task: string) => query({ prompt: task, options });
