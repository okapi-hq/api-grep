import requests

API = "https://api.example-weather.com/v2/forecast"


def forecast_default(city, version="2024-06-01"):
    return requests.get(API, params={"city": city}, headers={"X-Api-Version": version})


def forecast_pinned(city, version="2024-06-01"):
    return requests.get(API, params={"city": city}, headers={"X-Api-Version": version})


def forecast_any(city, version="2024-06-01"):
    return requests.get(API, params={"city": city}, headers={"X-Api-Version": version})


def pinned(city):
    forecast_pinned(city)
    return forecast_pinned(city, version="2025-01-15")


def any_version(city, requested):
    forecast_any(city)
    return forecast_any(city, version=requested)
