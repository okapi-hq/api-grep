import requests


class Provider:
    def __init__(self, session, fetch_fn=None):
        self.session = session
        self.fetch_fn = fetch_fn or requests.get

    def run(self, prompt: str):
        return self.session.post("https://api.mistral.ai/v1/chat/completions", json={"prompt": prompt})

    def health(self):
        return self.fetch_fn("https://api.mistral.ai/v1/models")


def call_upstream(deps, url: str):
    return deps.fetch_upstream(url)


def lookup(cache, url: str):
    return cache.get(url)
