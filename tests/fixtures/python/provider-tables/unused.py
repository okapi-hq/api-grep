import requests

# Shown on a settings page; requests go to the URL the user saved.
LINKS = {
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
}


def describe(name: str) -> str:
    return f"{name}: {LINKS[name]}"


def check(saved_url: str):
    print(describe("openai"))
    return requests.get(saved_url + "/health")
