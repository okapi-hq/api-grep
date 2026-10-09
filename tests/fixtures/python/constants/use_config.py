import requests

from config import urls
from config.urls import LINEAR, NOTION_API, Endpoints


def page(page_id: str):
    return requests.get(f"{NOTION_API}/pages/{page_id}")


def viewer():
    return requests.post(LINEAR["base"] + LINEAR["graphql"], json={"query": "{ viewer { id } }"})


def projects():
    return requests.get(Endpoints.VERCEL + "/v9/projects")


def database(db_id: str):
    return requests.post(urls.NOTION_API + "/databases/%s/query" % db_id, json={})
