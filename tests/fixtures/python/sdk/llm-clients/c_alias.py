from dataclasses import dataclass
from typing import Any, Optional

from anthropic import Anthropic as AnthropicClient
from anthropic import AsyncAnthropic as AsyncAnthropicClient


class Model:
    pass


@dataclass
class Claude(Model):
    id: str = "claude-3-5-sonnet-20241022"
    max_tokens: int = 1024
    api_key: Optional[str] = None
    client: Optional[AnthropicClient] = None
    async_client: Optional[AsyncAnthropicClient] = None

    def prepare_request_kwargs(self) -> dict:
        return {"max_tokens": self.max_tokens}

    def get_client(self) -> AnthropicClient:
        if self.client is None:
            _client_params: dict[str, Any] = {"api_key": self.api_key}
            self.client = AnthropicClient(**_client_params)
        return self.client

    def get_async_client(self) -> AsyncAnthropicClient:
        if self.async_client:
            return self.async_client
        self.async_client = AsyncAnthropicClient(api_key=self.api_key)
        return self.async_client

    def response(self, messages):
        return self.get_client().messages.create(model=self.id, messages=messages, **self.prepare_request_kwargs())

    async def aresponse(self, messages):
        return await self.get_async_client().messages.create(model=self.id, messages=messages, **self.prepare_request_kwargs())
