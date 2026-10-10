import httpx2
from httpx2 import Client

BASE = "https://api.example-weather.com"


def forecast(city):
    return httpx2.get(f"{BASE}/forecast", params={"q": city})


def alerts():
    with Client(base_url=BASE) as client:
        return client.get("/alerts")
