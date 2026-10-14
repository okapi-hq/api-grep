import Anthropic from "@anthropic-ai/sdk";
import { createContext, useContext, useMemo, type ReactNode } from "react";

// a client the app hands down its own React context, through its gateway
const AssistantContext = createContext<{ client: Anthropic } | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => new Anthropic({ baseURL: "https://llm.example-gateway.io", dangerouslyAllowBrowser: true }), []);
  const value = useMemo(() => ({ client }), [client]);
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAsk() {
  const { client } = useContext(AssistantContext)!;
  return (question: string) => client.messages.create({ model: "claude-sonnet-4-5", max_tokens: 512, messages: [{ role: "user", content: question }] });
}
