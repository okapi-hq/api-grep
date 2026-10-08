from unittest import mock

import requests

DOCS_URL = "https://api.stripe.com/docs"


def render(template):
    return template.render(link=DOCS_URL, image="https://images.example.com/logo.png")


def local_file(path: str):
    with open(path) as fh:
        return fh.read()


def exceptions():
    try:
        pass
    except requests.exceptions.HTTPError as err:
        raise requests.exceptions.ConnectionError("down") from err


def session_setup():
    s = requests.Session()
    s.headers.update({"User-Agent": "app"})
    s.mount("https://", requests.adapters.HTTPAdapter(max_retries=3))
    return s


@mock.patch("requests.get")
def patched(get):
    return get


def options(params):
    return params.get("url")
