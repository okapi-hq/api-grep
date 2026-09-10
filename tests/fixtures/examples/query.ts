import axios from "axios";

export function list(page: number, status: "open" | "closed") {
  return fetch(`https://api.example.com/v1/tickets?page=${page}&status=${status}&expand=owner`);
}

export function search(q: string, limit?: number) {
  return axios.get("https://api.example.com/v1/search", { params: { q, limit, sort: "asc" } });
}

export function paged(cursor: string) {
  const url = new URL("https://api.example.com/v1/items");
  url.searchParams.set("cursor", cursor);
  url.searchParams.set("limit", "50");
  return fetch(url);
}
