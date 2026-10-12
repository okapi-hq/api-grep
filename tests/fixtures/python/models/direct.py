import os

from anthropic import Anthropic
from openai import OpenAI

from settings import CHAT_MODEL, TRANSCRIBE_MODEL, reasoning_model, settings

client = OpenAI()
claude = Anthropic()


def chat(messages):
    return client.chat.completions.create(model=CHAT_MODEL, messages=messages, temperature=0.2)


def summarize(text):
    return client.responses.create(model=settings.summary_model, input=text)


def transcribe(audio):
    return client.audio.transcriptions.create(model=TRANSCRIBE_MODEL, file=audio)


def think(prompt):
    return client.chat.completions.create(model=reasoning_model(), messages=[{"role": "user", "content": prompt}], reasoning_effort="high")


def describe(image, fast):
    model = "claude-3-haiku-20240307" if fast else settings.vision_model
    return claude.messages.create(model=model, max_tokens=512, messages=[{"role": "user", "content": image}])


def pick(name):
    return client.chat.completions.create(model=name or os.getenv("FALLBACK_MODEL") or "gpt-3.5-turbo", messages=[])


def anything(model_name, messages):
    return client.chat.completions.create(model=model_name, messages=messages)


def secret_default():
    return client.chat.completions.create(model=os.getenv("PROXY_MODEL", "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD"), messages=[])
