const BASES = {
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
};
const CHOSEN = "mistral";

function baseUrlFor(provider: string): string {
  switch (provider) {
    case "groq":
      return "https://api.groq.com/openai/v1";
    default:
      return "https://api.mistral.ai/v1";
  }
}

// keys and arguments the code fixes pick one entry: no host table
export const mistralModels = () => fetch(`${BASES[CHOSEN]}/models`);
export const groqModels = () => fetch(`${baseUrlFor("groq")}/models`);
