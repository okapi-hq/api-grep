// A table of URLs no request uses: shown in a settings screen only.
export const PROVIDER_LINKS = {
  openai: { baseUrl: "https://api.openai.com/v1", docs: "https://platform.openai.com/docs" },
  mistral: { baseUrl: "https://api.mistral.ai/v1", docs: "https://docs.mistral.ai" },
};

export function label(name: keyof typeof PROVIDER_LINKS): string {
  return `${name}: ${PROVIDER_LINKS[name].baseUrl}`;
}

export async function ping(target: string) {
  // the table is displayed, the request goes to a URL the user typed
  console.log(label("openai"));
  return fetch(`${target}/health`);
}
