import httpx

from .settings import VERCEL_API


async def deployments(team: str):
    async with httpx.AsyncClient(base_url=VERCEL_API, headers={"Authorization": "Bearer token"}) as client:
        return await client.get("/v6/deployments", params={"teamId": team, "limit": 20})


def slack_post(channel: str, text: str):
    client = httpx.Client()
    return client.post("https://slack.com/api/chat.postMessage", json={"channel": channel, "text": text})


def raw_put(key: str, payload: bytes):
    return httpx.request("PUT", f"https://api.example.com/v1/blobs/{key}", content=payload)


def stream_logs(job: str):
    with httpx.stream("GET", f"https://api.example.com/v1/jobs/{job}/logs") as r:
        return r
