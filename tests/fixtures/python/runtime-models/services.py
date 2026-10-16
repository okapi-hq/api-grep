import os

import requests
from anthropic import Anthropic
from groq import Groq
from openai import OpenAI

from settings import LegacySettings, Reply, Workflow, get_settings, settings

openai_client = OpenAI()


class Summarizer:
    DEFAULT_MODEL = "gpt-4.1-nano"

    def __init__(self, model: str | None = None, temperature: float = 0.2):
        self._model = model or self.DEFAULT_MODEL
        self.temperature = temperature

    def run(self, text):
        return openai_client.chat.completions.create(model=self._model, messages=[{"role": "user", "content": text}])


class FastChat:
    def __init__(self, model: str | None = None):
        self.groq = Groq()
        self.model = model or os.environ.get("FAST_MODEL", "llama-3.1-8b-instant")
        self.args = {"model": os.getenv("FAST_FALLBACK") or "llama-3.3-70b-versatile", "temperature": 0.3}

    def ask(self, q):
        return self.groq.chat.completions.create(model=self.model, messages=[{"role": "user", "content": q}])

    def ask_with(self, q, **kwargs):
        return self.groq.chat.completions.create(model=kwargs.pop("model", None) or self.args["model"], messages=[])

    def ask_args(self, q, args=None):
        args = args or {}
        return self.groq.chat.completions.create(model=args.get("model", self.args["model"]), messages=[])


class Writer:
    def __init__(self, model="claude-3-7-sonnet-latest"):
        self.model = model
        self.claude = Anthropic()

    def write(self, prompt):
        return self.claude.messages.create(model=self.model, max_tokens=512, messages=[{"role": "user", "content": prompt}])


def chat(messages):
    return openai_client.chat.completions.create(model=settings.chat_model, messages=messages)


def summarize(text):
    return openai_client.chat.completions.create(model=get_settings().summary_model, messages=[])


def embed(text):
    s = get_settings()
    return openai_client.embeddings.create(model=s.embedding_model, input=text)


def fast(q):
    return Groq().chat.completions.create(model=settings.groq_model, messages=[])


def describe(image):
    return openai_client.chat.completions.create(model=LegacySettings().vision_model, messages=[])


def reply(q):
    return Anthropic().messages.create(model=Reply().model, max_tokens=64, messages=[])


def plan(config):
    workflow = Workflow.from_config(config)
    return Anthropic().messages.create(model=workflow.writer_model, max_tokens=64, messages=[])


def chat_raw(messages, options: dict):
    payload = {"model": options.get("model", "gpt-4o-2024-08-06"), "messages": messages}
    return requests.post("https://api.openai.com/v1/chat/completions", json=payload, timeout=30)
