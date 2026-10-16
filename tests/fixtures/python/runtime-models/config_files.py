import json
import os
import tomllib

import yaml
from openai import OpenAI

client = OpenAI()

CONFIG = yaml.safe_load(open("config.yaml"))
with open("settings.json") as f:
    SETTINGS = json.load(f)
with open(os.path.join(os.path.dirname(__file__), "models.toml"), "rb") as fh:
    MODELS = tomllib.load(fh)


def chat(messages):
    return client.chat.completions.create(model=CONFIG["llm"]["model"], messages=messages)


def embed(text):
    return client.embeddings.create(model=CONFIG.get("embeddings", {}).get("model"), input=text)


def judge(messages):
    return client.chat.completions.create(model=SETTINGS.get("judge_model", "gpt-4o"), messages=messages)


def route(messages):
    return client.chat.completions.create(model=MODELS["router"]["model"], messages=messages)
