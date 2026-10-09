import os

import requests
from requests.auth import HTTPBasicAuth

STRIPE_KEY = os.environ["STRIPE_SECRET_KEY"]


def create_customer(email: str):
    return requests.post(
        "https://api.stripe.com/v1/customers",
        data={"email": email, "name": "Ada Lovelace"},
        headers={"Authorization": f"Bearer {STRIPE_KEY}"},
    )


def list_issues(owner: str, repo: str, state: str = "open"):
    return requests.get(f"https://api.github.com/repos/{owner}/{repo}/issues", params={"state": state, "per_page": 50})


def delete_page(page_id: str):
    return requests.delete("https://api.notion.com/v1/blocks/" + page_id, headers={"Notion-Version": "2022-06-28"})


def upload(path: str):
    with open(path, "rb") as fh:
        return requests.post("https://api.cloudinary.com/v1_1/demo/image/upload", files={"file": fh}, auth=HTTPBasicAuth("key", "secret"))


def ping(method: str):
    return requests.request(method, "https://api.linear.app/graphql", json={"query": "{ viewer { id } }"})
