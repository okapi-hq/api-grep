import requests


def top_charts(url: str = ""):
    url = url or "https://charts.example.com/top?limit=250"
    return requests.get(url, timeout=10)
