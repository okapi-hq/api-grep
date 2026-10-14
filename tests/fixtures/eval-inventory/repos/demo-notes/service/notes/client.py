import requests

BASE = "http://localhost:8000"


def health():
    return requests.get(f"{BASE}/health")


def releases(owner, repo):
    return requests.get(f"https://api.github.com/repos/{owner}/{repo}/releases")


def tags(owner, repo):
    return requests.get(f"https://api.github.com/repos/{owner}/{repo}/tags")


def push(url, payload):
    return requests.post(url, json=payload)
