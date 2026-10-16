from client_wrapper import AsyncClientWrapper, SyncClientWrapper
from encoder import to_jsonable


class NotesClient:
    def __init__(self, *, client_wrapper: SyncClientWrapper):
        self._client_wrapper = client_wrapper

    def get_note(self, id: str, *, request_options=None):
        return self._client_wrapper.httpx_client.request(f"v1/notes/{to_jsonable(id)}", method="GET", request_options=request_options)

    def delete_note(self, id: str, *, request_options=None):
        return self._client_wrapper.httpx_client.request(f"v1/notes/{to_jsonable(id)}", method="DELETE", request_options=request_options)

    def list_notes(self, *, page=None, request_options=None):
        return self._client_wrapper.httpx_client.request("v1/notes", method="GET", params={"page": page}, request_options=request_options)

    def create_note(self, *, text: str, request_options=None):
        return self._client_wrapper.httpx_client.request("v1/notes", method="POST", json={"text": text}, request_options=request_options)


class AsyncNotesClient:
    def __init__(self, *, client_wrapper: AsyncClientWrapper):
        self._client_wrapper = client_wrapper

    async def get_note(self, id: str, *, request_options=None):
        return await self._client_wrapper.httpx_client.request(f"v1/notes/{to_jsonable(id)}", method="GET", request_options=request_options)

    async def list_notes(self, *, page=None, request_options=None):
        return await self._client_wrapper.httpx_client.request("v1/notes", method="GET", params={"page": page}, request_options=request_options)
