import requests


def send_event(options: dict):
    return requests.post("https://api.segment.io/v1/track", **options)


def send_typed(payload):
    return requests.post("https://api.segment.io/v1/identify", json=payload)
