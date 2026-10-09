interface Settings {
  environment: "cloud" | "selfHosted";
  domain: string;
}

function baseUrl(s: Settings): string {
  return s.environment === "cloud" ? "https://api.example-vault.com" : `${s.domain}/api`;
}

export function listItems(s: Settings) {
  return fetch(`${baseUrl(s)}/items`);
}

interface Ctx {
  region: string;
}

function vaultHost(this: Ctx): string {
  return "https://api.example-vault.com";
}

export function readSecret(this: Ctx, name: string) {
  return fetch(`${vaultHost.call(this)}/v1/secrets/${name}`);
}
