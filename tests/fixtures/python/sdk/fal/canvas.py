import os

import fal_client
from fal_client import AsyncClient, SyncClient

client = SyncClient(key=os.environ["FAL_KEY"])
aclient = AsyncClient()


def paint(prompt: str):
    return fal_client.run("fal-ai/flux/dev", arguments={"prompt": prompt, "num_images": 1})


def paint_queued(prompt: str):
    return fal_client.subscribe("fal-ai/flux/schnell", arguments={"prompt": prompt}, with_logs=True)


def enqueue(prompt: str):
    return client.submit("acme-studio/upscaler", {"image_url": prompt}, webhook_url="https://hooks.example.com/fal")


def check(request_id: str):
    return fal_client.status("acme-studio/upscaler", request_id, with_logs=True)


def fetch(request_id: str):
    return client.result("acme-studio/upscaler", request_id)


def stop(request_id: str):
    return fal_client.cancel("acme-studio/upscaler", request_id)


def wait_for(prompt: str):
    handle = fal_client.submit("fal-ai/flux/dev", arguments={"prompt": prompt})
    return handle.get()


def tokens(prompt: str):
    for event in fal_client.stream("acme-studio/storyteller", arguments={"prompt": prompt}):
        yield event


def share(path: str):
    return fal_client.upload_file(path)


async def later(app_id: str, prompt: str):
    return await aclient.run(app_id, arguments={"prompt": prompt})


async def later_queued(prompt: str):
    return await fal_client.subscribe_async("fal-ai/flux/dev", arguments={"prompt": prompt})


def by_handle(request_id: str):
    return client.get_handle("acme-studio/upscaler", request_id).status()
