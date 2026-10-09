import json
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def meta():
    return urlopen("https://api.github.com/meta")


def post_event(event: dict):
    req = Request("https://api.segment.io/v1/track", data=json.dumps(event).encode("utf-8"), headers={"Content-Type": "application/json"})
    return urlopen(req)


def subscribe(email: str):
    return urlopen("https://api.mailgun.net/v3/lists/news@example.com/members", data=urlencode({"address": email}).encode())


def remove(list_id: str):
    return urlopen(Request(f"https://api.mailgun.net/v3/lists/{list_id}", method="DELETE"))
