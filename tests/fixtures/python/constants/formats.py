import os
from urllib.parse import urljoin

import requests

API = "https://api.cal.com"


def booking(uid: str):
    return requests.get("{}/v1/bookings/{}".format(API, uid), params={"apiKey": os.getenv("CAL_KEY")})


def booking_named(uid: str):
    return requests.get("{base}/v1/bookings/{uid}".format(base=API, uid=uid))


def users(team_id: int):
    return requests.get("/".join([API, "v1", "teams", str(team_id), "users"]))


def joined(path: str):
    return requests.get(urljoin(API, "/v2/me"))


def other(path: str):
    url = API
    url += "/v1/schedules"
    return requests.get(url)


def env_host():
    return requests.get(os.environ.get("ANALYTICS_HOST") + "/v1/batch")
