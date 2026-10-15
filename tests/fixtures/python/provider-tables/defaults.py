from dataclasses import dataclass

import httpx
from openai import OpenAI


@dataclass(frozen=True)
class ProviderDefault:
    name: str
    base_url: str
    model: str


DEFAULTS = [
    ProviderDefault(name="groq", base_url="https://api.groq.com/openai/v1", model="llama-3.3-70b-versatile"),
    ProviderDefault(name="mistral", base_url="https://api.mistral.ai/v1", model="mistral-small-latest"),
    ProviderDefault(name="together", base_url="https://api.together.xyz/v1", model="meta-llama/Llama-3-8b-chat-hf"),
]


def client_for(name: str) -> OpenAI:
    p = next(d for d in DEFAULTS if d.name == name)
    return OpenAI(base_url=p.base_url)


def ask(name: str, prompt: str):
    p = next((d for d in DEFAULTS if d.name == name), None)
    client = OpenAI(base_url=p.base_url)
    return client.chat.completions.create(model=p.model, messages=[{"role": "user", "content": prompt}])


def raw(name: str, prompt: str):
    p = [d for d in DEFAULTS if d.name == name][0]
    return httpx.post(f"{p.base_url}/chat/completions", json={"model": p.model, "messages": [{"role": "user", "content": prompt}]})
