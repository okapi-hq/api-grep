import { getClaude, getOpenAI } from "./clients";

export const structured = (input: string) => getOpenAI().chat.completions.parse({ model: "gpt-4o", messages: [{ role: "user", content: input }] });

export const streamed = (input: string) => getOpenAI().chat.completions.stream({ model: "gpt-4o-mini", messages: [{ role: "user", content: input }] });

export const legacyParse = (input: string) => getOpenAI().beta.chat.completions.parse({ model: "gpt-4.1", messages: [{ role: "user", content: input }] });

export const responseStream = (input: string) => getOpenAI().responses.stream({ model: "gpt-4.1-mini", input });

export const tools = (input: string) => getOpenAI().chat.completions.runTools({ model: "gpt-4.1", messages: [{ role: "user", content: input }], tools: [] });

export const claudeParse = (input: string) => getClaude().beta.messages.parse({ model: "claude-sonnet-4-5", max_tokens: 512, messages: [{ role: "user", content: input }] });

export const claudeBeta = (input: string) => getClaude().beta.messages.create({ model: "claude-opus-4-1", max_tokens: 512, messages: [{ role: "user", content: input }] });
