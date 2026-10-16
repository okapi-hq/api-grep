import httpx

from http_client import AsyncHttpClient, HttpClient


class SyncClientWrapper:
    def __init__(self, *, base_url: str, httpx_client: httpx.Client):
        self._base_url = base_url
        self.httpx_client = HttpClient(httpx_client=httpx_client, base_url=self.get_base_url)

    def get_base_url(self) -> str:
        return self._base_url


class AsyncClientWrapper:
    def __init__(self, *, base_url: str, httpx_client: httpx.AsyncClient):
        self._base_url = base_url
        self.httpx_client = AsyncHttpClient(httpx_client=httpx_client, base_url=self.get_base_url)

    def get_base_url(self) -> str:
        return self._base_url
