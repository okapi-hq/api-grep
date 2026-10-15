from dataclasses import dataclass, field
from functools import cached_property

from anthropic import Anthropic, AsyncAnthropic
from openai import AsyncOpenAI, OpenAI


class Assistant:
    def __init__(self, model: str):
        self.model = model
        self._llm = None

    def _get_llm_client(self):
        if self._llm is None:
            self._llm = AsyncOpenAI()
        return self._llm

    async def answer(self, prompt: str):
        client = self._get_llm_client()
        return await client.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": prompt}])

    def client_for(self, model: str):
        if model.startswith("claude"):
            return Anthropic()
        return OpenAI()

    def ask_claude(self, prompt: str):
        return self.client_for("claude-opus-4-1").messages.create(model="claude-opus-4-1", max_tokens=100, messages=[{"role": "user", "content": prompt}])

    def ask_gpt(self, prompt: str):
        return self.client_for("gpt-4.1").chat.completions.create(model="gpt-4.1", messages=[{"role": "user", "content": prompt}])

    @property
    def claude(self):
        return AsyncAnthropic()

    async def summarize(self, text: str):
        return await self.claude.messages.create(model="claude-haiku-4-5", max_tokens=200, messages=[{"role": "user", "content": text}])

    @cached_property
    def embedder(self) -> OpenAI:
        return OpenAI()

    def embed(self, text: str):
        return self.embedder.embeddings.create(model="text-embedding-3-large", input=text)


@dataclass
class Settings:
    client: OpenAI = field(default_factory=OpenAI)

    def moderate(self, text: str):
        return self.client.moderations.create(input=text)
