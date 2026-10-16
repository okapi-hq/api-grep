import json
import os

import yaml
from openai import OpenAI

client = OpenAI()
TIMEOUT = os.getenv("REQUEST_TIMEOUT", "30")
DEFAULTS = {"temperature": "0.2", "model": os.environ["NOTES_UNDOCUMENTED"]}


def load(path):
    return yaml.safe_load(open(path))


def documented_elsewhere(messages):
    # TIMEOUT's default and the dict's other keys are no model
    return client.chat.completions.create(model=DEFAULTS["model"], messages=messages, timeout=float(TIMEOUT))


def from_a_path_known_at_run_time(path, messages):
    return client.chat.completions.create(model=load(path)["model"], messages=messages)


def ambiguous_example(messages):
    return client.chat.completions.create(model=os.environ["EMBED_PROVIDER_MODEL"], messages=messages)


def outside(messages):
    return client.chat.completions.create(model=json.load(open("../outside.json"))["model"], messages=messages)


def interpolated(messages):
    # filled in by the program from an env var: not a model name
    return client.chat.completions.create(model=yaml.safe_load(open("config.yaml"))["llm"]["fallback"], messages=messages)


class MockClient:
    # a stand-in default in code that is no test: no model a provider serves
    def __init__(self, model="mock-model"):
        self.model = model

    def ask(self, messages):
        return client.chat.completions.create(model=self.model, messages=messages)


def composed(messages):
    return client.chat.completions.create(model=os.getenv("PIPELINE_ID", "unknown+pipeline"), messages=messages)
