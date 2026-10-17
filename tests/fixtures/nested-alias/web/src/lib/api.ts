const BASE = "https://api.shopfront-demo.io";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { authorization: "Bearer demo" } });
  return (await res.json()) as T;
}
