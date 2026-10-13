import os

from openai import OpenAI

client = OpenAI()


def chat(messages):
    return client.chat.completions.create(model=os.environ["CHAT_MODEL"], messages=messages)


def embed(text):
    return client.embeddings.create(model=os.getenv("EMBED_MODEL", "text-embedding-3-large"), input=text)


def guess(messages):
    return client.chat.completions.create(model=os.environ["PLACEHOLDER_MODEL"], messages=messages)
