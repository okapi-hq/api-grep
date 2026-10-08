export interface TextProvider {
  generate(prompt: string): Promise<string>;
}

// A placeholder for a provider that is not wired yet: it never sends anything.
export class StubProvider implements TextProvider {
  async generate(_prompt: string): Promise<string> {
    throw new Error("StubProvider.generate is not implemented");
  }
}

export async function draft(provider: TextProvider, topic: string) {
  return provider.generate(`Write about ${topic}`);
}

export const sample = () => new StubProvider().generate("hello");
