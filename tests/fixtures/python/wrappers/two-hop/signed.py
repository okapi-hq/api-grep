import httpx


def do_fetch(url: str, payload: dict):
    return httpx.post(url, json=payload)


def signed_fetch(path: str, payload: dict):
    return do_fetch("https://api.mixpanel.com" + path, payload)


def tracked(event: str):
    return signed_fetch("/track", {"event": event})


def deep(event: str):
    return tracked(event)
