const BASE = "https://api.unsplash.com";

export function search(q: string) {
  const u = new URL("/search/photos", BASE);
  u.searchParams.set("query", q);
  return fetch(u, { headers: { Authorization: "Client-ID abc" } });
}

export function searchToString(q: string) {
  return fetch(new URL(`/search/collections?q=${q}`, BASE).toString());
}
