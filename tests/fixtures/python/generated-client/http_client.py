import urllib.parse

import httpx

from encoder import to_jsonable


class HttpClient:
    def __init__(self, *, httpx_client: httpx.Client, base_url):
        self.httpx_client = httpx_client
        self.base_url = base_url

    def request(self, path=None, *, method, params=None, json=None, request_options=None):
        base_url = self.base_url()
        timeout = request_options.get("timeout_in_seconds") if request_options is not None else 60
        return self.httpx_client.request(
            method=method,
            url=urllib.parse.urljoin(f"{base_url}/", path),
            params=to_jsonable({**(params or {}), **(request_options.get("extra_query", {}) if request_options is not None else {})}),
            json=to_jsonable(json),
            timeout=timeout,
        )


class AsyncHttpClient:
    def __init__(self, *, httpx_client: httpx.AsyncClient, base_url):
        self.httpx_client = httpx_client
        self.base_url = base_url

    async def request(self, path=None, *, method, params=None, json=None, request_options=None):
        base_url = self.base_url()
        return await self.httpx_client.request(method=method, url=urllib.parse.urljoin(f"{base_url}/", path), params=to_jsonable(params), json=to_jsonable(json))
