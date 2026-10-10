import httpx

CATALOG_API = "https://api.example-catalog.com"
_client = httpx.Client()


def send(method, url, headers):
    return _client.request(method, url, headers=headers)


def signed(method, url):
    return send(method, url, {"x-signature": "static"})


def catalog(method, path):
    return signed(method, f"{CATALOG_API}/v2{path}")


def proxy(path, method="GET"):
    return catalog(method, path)


def list_products(page):
    return proxy(f"/products?page={page}")


def archive_product(product_id):
    return proxy(f"/products/{product_id}/archive", method="POST")
