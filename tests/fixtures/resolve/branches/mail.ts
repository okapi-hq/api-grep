function endpointFor(region: string): string {
  if (region === "eu") return "https://api.eu.example-mail.com/api/v1";
  return "https://api.example-mail.com/api/v1";
}

export function send(region: string, body: unknown) {
  return fetch(`${endpointFor(region)}/transmissions`, { method: "POST", body: JSON.stringify(body) });
}

export function listGroups(version: number, path: string) {
  return fetch(version === 1 ? `https://api.example-mail.com/v2${path}` : `https://connect.example-mail.com/api${path}`);
}

export function charge(path: string) {
  let url: string;
  if (path.startsWith("https://")) {
    url = path;
  } else {
    url = `https://api.example-charge.com/v2${path}`;
  }
  return fetch(url, { method: "POST" });
}
