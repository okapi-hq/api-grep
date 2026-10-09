const BASE = "https://api.example.com";

// a retry sends the same request again
async function withRetry(path: string) {
  const res = await fetch(`${BASE}${path}`);
  return res.ok ? res : fetch(`${BASE}${path}`);
}

async function upsert(id: string, body: unknown) {
  const found = await fetch(`${BASE}/items/${id}`);
  if (found.ok) return fetch(`${BASE}/items/${id}`, { method: "PUT", body: JSON.stringify(body) });
  return fetch(`${BASE}/items`, { method: "POST", body: JSON.stringify(body) });
}

export const status = () => withRetry("/status");
export const save = (item: { id: string; name: string }) => upsert(item.id, item);
