import requests


class Endpoint:
    def __init__(self, host, path="/v1/status", method="GET"):
        self.url = "https://" + host + path
        self.method = method


def call(endpoint):
    return requests.request(endpoint.method, endpoint.url)


def status():
    return call(Endpoint("api.example-status.com"))


def restart(job):
    return call(Endpoint("api.example-status.com", path=f"/v1/jobs/{job}/restart", method="POST"))
