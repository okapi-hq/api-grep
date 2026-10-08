import os

import requests


def models():
    return requests.get(f"{os.environ['OPENROUTER_BASE_URL']}/models")


def transcribe(audio_url: str):
    return requests.post(os.getenv("GLADIA_API_URL") + "/v2/transcription", json={"audio_url": audio_url})
