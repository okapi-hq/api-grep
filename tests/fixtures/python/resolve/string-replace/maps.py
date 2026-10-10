import re

import requests

BASE = "https://api.example-maps.com/v2/{region}/"


def tiles(region, z):
    return requests.get(BASE.replace("{region}", region) + f"tiles/{z}")


def status(base_url):
    base = re.sub(r"/+$", "", base_url or "https://api.example-maps.com")
    return requests.get(base + "/status")
