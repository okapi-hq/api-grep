import { OpenAIService, OtherService, Summarizer } from "./service";

export class Agent {
  private service: OpenAIService;
  private other: OtherService;
  constructor(opts: { llm: string }) {
    const model = opts.llm.split("/").pop();
    this.service = new OpenAIService(model);
    this.other = new OtherService(opts.llm);
  }

  start(input: string) {
    return this.service.generateText(input);
  }

  startOther(input: string) {
    return this.other.generateText(input);
  }

  chat(input: string) {
    return this.start(input);
  }
}

export const run = () => new Agent({ llm: "openai/gpt-4o-mini" }).chat("hi");
export const runOther = () => new Agent({ llm: "openai/gpt-4o-mini" }).startOther("hi");

// nothing overrides the summarizer's model: its default is what it sends
export const summarize = (text: string) => new Summarizer().summarize(text);
