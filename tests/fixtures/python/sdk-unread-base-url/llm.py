import os

from openai import OpenAI


class Inference:
    def __init__(self, base_url: str):
        self.client = OpenAI(base_url=base_url, api_key="local")

    def ask(self, question: str):
        return self.client.chat.completions.create(model="qwen2.5", messages=[{"role": "user", "content": question}])


settings = load_settings()
served = OpenAI(base_url=settings["inference_url"], api_key="local")
local = OpenAI(base_url=os.getenv("INFERENCE_URL", "http://localhost:8000/v1"))
fallback = OpenAI(base_url=None)


def via_settings(prompt: str):
    return served.chat.completions.create(model="llama-3.1-8b", messages=[{"role": "user", "content": prompt}])


def via_env(prompt: str):
    return local.chat.completions.create(model="llama-3.1-8b", messages=[{"role": "user", "content": prompt}])


def via_default(prompt: str):
    return fallback.chat.completions.create(model="gpt-4o-mini", messages=[{"role": "user", "content": prompt}])
