import requests


def base_url(settings):
    return "https://api.example-vault.com" if settings["cloud"] else settings["domain"] + "/api"


def list_items(settings):
    return requests.get(base_url(settings) + "/items")
