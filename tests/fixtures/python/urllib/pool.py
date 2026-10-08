import urllib3

http = urllib3.PoolManager()


def search(q: str):
    return http.request("GET", "https://api.unsplash.com/search/photos", fields={"query": q})


def notify(payload: dict):
    return http.request("POST", "https://events.pagerduty.com/v2/enqueue", json=payload)
