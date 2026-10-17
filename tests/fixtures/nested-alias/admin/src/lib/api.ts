export function apiFetch(path: string, init?: RequestInit) {
  return fetch(`https://admin.shopfront-demo.io/api${path}`, init);
}
