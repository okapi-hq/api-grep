export function summarize(llm, text: string) {
  return llm.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: `Summarize: ${text}` }] });
}
