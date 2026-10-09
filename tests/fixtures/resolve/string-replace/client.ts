interface Creds {
  server?: string;
}

export function installationToken(creds: Creds, id: string) {
  const baseUrl = String(creds.server ?? "https://api.example-git.com").replace(/\/$/, "");
  return fetch(`${baseUrl}/app/installations/${id}/access_tokens`, { method: "POST" });
}

export function profile(id: string) {
  return fetch("https://api.example-crm.com/users/:id/profile".replace(":id", id));
}

export function records(basin: string, stream: string) {
  return fetch("https://{basin}.example-stream.dev/v1".replace("{basin}", basin) + `/streams/${stream}/records`);
}
