async function proxied(url: string, init?: RequestInit) {
  const target = new URL(url);
  return fetch(target.href, { ...init, headers: { "User-Agent": "x" } });
}

export const ping = () => proxied("https://api.pagerduty.com/incidents", { method: "POST" });
