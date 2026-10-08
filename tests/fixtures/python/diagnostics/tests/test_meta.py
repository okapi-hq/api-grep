import requests


def test_meta():
    assert requests.get("https://api.github.com/meta").ok
