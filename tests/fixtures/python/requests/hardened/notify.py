from .http_client import HTTPClient


def notify(payload):
    return HTTPClient.send_request("POST", "https://hooks.example-chat.com/notify", json=payload)
