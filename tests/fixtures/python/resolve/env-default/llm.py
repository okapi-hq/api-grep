import os

import httpx

BASE_URL = os.getenv("LANGDOCK_BASE_URL", "https://api.langdock.com/openai/eu/v1")
VOICE = os.environ.get("ELEVENLABS_URL") or "https://api.elevenlabs.io"


def complete(prompt: str):
    return httpx.post(f"{BASE_URL}/chat/completions", json={"model": "gpt-4o", "messages": [{"role": "user", "content": prompt}]})


def speak(voice_id: str, text: str):
    return httpx.post(f"{VOICE}/v1/text-to-speech/{voice_id}", json={"text": text})
