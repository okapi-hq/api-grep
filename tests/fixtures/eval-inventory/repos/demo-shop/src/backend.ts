export async function api(path: string) {
  return fetch(`/api${path}`, { headers: { accept: "application/json" } });
}

export const me = () => api("/me");

export const cart = () => api("/cart");
