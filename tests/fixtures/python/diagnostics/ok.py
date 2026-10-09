import requests


def meta():
    return requests.get("https://api.github.com/meta")
