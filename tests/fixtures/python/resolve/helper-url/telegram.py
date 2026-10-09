import os

import requests

TOKEN = os.environ["TELEGRAM_TOKEN"]


def api_url(method: str) -> str:
    return f"https://api.telegram.org/bot{TOKEN}/{method}"


graph_url = lambda path: "https://graph.facebook.com/v19.0/" + path


def send_message(chat_id: int, text: str):
    return requests.post(api_url("sendMessage"), json={"chat_id": chat_id, "text": text})


def page_feed(page_id: str):
    return requests.get(graph_url(page_id + "/feed"))
