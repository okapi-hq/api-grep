const HOSTS = {
  us: "https://api.example-mailer.com/v3/",
  eu: "https://api.eu.example-mailer.com/v3/",
} as const;

export function send(region: keyof typeof HOSTS, body: string) {
  return fetch(HOSTS[region] + "messages", { method: "POST", body });
}

export function sendFromEurope(body: string) {
  return fetch(HOSTS["eu"] + "messages", { method: "POST", body });
}
