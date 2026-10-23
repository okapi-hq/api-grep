import os

import replicate
from replicate import Client

client = Client(api_token=os.environ["REPLICATE_API_TOKEN"])


def sketch(prompt: str):
    return replicate.run("acme-labs/sketchy:5f1b2c3d4e5f60718293a4b5c6d7e8f9", input={"prompt": prompt, "steps": 20})


def poster(prompt: str):
    return replicate.run("acme-labs/poster-maker", input={"prompt": prompt})


def caption(image_url: str):
    return client.run("acme-labs/captioner", input={"image": image_url})


def queued(prompt: str):
    return client.predictions.create(model="acme-labs/poster-maker", input={"prompt": prompt}, webhook="https://hooks.example.com/done", wait=60)


def by_version(prompt: str):
    return replicate.predictions.create("5f1b2c3d4e5f60718293a4b5c6d7e8f9", {"prompt": prompt})


def check(prediction_id: str):
    return replicate.predictions.get(prediction_id)


def stop(prediction_id: str):
    return client.predictions.cancel(prediction_id)


def on_deployment(text: str):
    return replicate.deployments.predictions.create(deployment="acme-labs/tuned-captioner", input={"text": text}, wait=True)


def on_deployment_object(text: str):
    deployment = replicate.deployments.get("acme-labs/tuned-captioner")
    return deployment.predictions.create(input={"text": text})


def through_model(prompt: str):
    return replicate.models.predictions.create(model="acme-labs/poster-maker", input={"prompt": prompt})


def versions():
    return replicate.models.get("acme-labs/sketchy").versions.list()


def tune(images_url: str):
    return replicate.trainings.create(
        model="acme-labs/sketchy",
        version="5f1b2c3d4e5f60718293a4b5c6d7e8f9",
        input={"images": images_url},
        destination="acme-labs/sketchy-tuned",
    )


def upload(path: str):
    with open(path, "rb") as f:
        return replicate.files.create(f)


async def later(model_ref: str, prompt: str):
    return await replicate.async_run(model_ref, input={"prompt": prompt})
