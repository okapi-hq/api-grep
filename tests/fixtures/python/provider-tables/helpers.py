import os

import requests


def base_url_for(provider: str) -> str:
    if provider == "groq":
        return os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
    return os.getenv("MISTRAL_BASE_URL", "https://api.mistral.ai/v1")


def models(provider: str):
    return requests.get(base_url_for(provider) + "/models")


def groq_models():
    # an argument the code fixes: one call, no table
    return requests.get(base_url_for("groq") + "/models")
