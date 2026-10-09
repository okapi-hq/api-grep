const CATALOG_API = "https://api.example-catalog.com";

async function send(base: string, path: string, method = "GET") {
  const url = new URL(base + path);
  url.searchParams.set("format", "json");
  const res = await fetch(url, { method });
  return res.json();
}

function catalog(path: string, method = "GET") {
  return send(CATALOG_API, `/v2${path}`, method);
}

function proxy(path: string, method = "GET") {
  return catalog(path, method);
}

function scoped(shop: string, path: string, method = "GET") {
  return proxy(`/shops/${shop}${path}`, method);
}

export const listProducts = (shop: string, page: number) => scoped(shop, `/products?page=${page}`);

export const archiveProduct = (shop: string, id: string) => scoped(shop, `/products/${id}/archive`, "POST");
