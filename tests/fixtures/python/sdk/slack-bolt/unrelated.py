"""Not Slack: a decorated function with a `client` parameter must not read as a bolt listener."""
import httpx
from fastapi import APIRouter

router = APIRouter()
scheduler_hooks = []


def every(minutes):
    def register(fn):
        scheduler_hooks.append((minutes, fn))
        return fn

    return register


@router.get("/health")
def health(client, say):
    client.chat_postMessage(channel="C0NOPE", text="not slack")
    say("not slack either")


@every(5)
def poll(client):
    client.chat_postMessage(channel="C0NOPE", text="still not slack")
    return httpx.get("https://status.example-uptime.dev/api/v1/ping")
