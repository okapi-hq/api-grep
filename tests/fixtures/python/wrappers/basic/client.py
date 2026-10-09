import requests

BASE = "https://api.intercom.io"


def intercom(method: str, path: str, body: dict | None = None):
    return requests.request(method, BASE + path, json=body, headers={"Authorization": "Bearer token"})


class Airtable:
    def __init__(self, base_id: str):
        self.base_id = base_id

    def _post(self, table: str, fields: dict):
        return requests.post(f"https://api.airtable.com/v0/{self.base_id}/{table}", json={"fields": fields})

    def create_task(self, title: str):
        return self._post("Tasks", {"Name": title})


def contacts():
    return intercom("GET", "/contacts")


def tag(contact_id: str, tag_id: str):
    return intercom("POST", f"/contacts/{contact_id}/tags", {"id": tag_id})
