import httpx


class GladiaClient:
    def __init__(self, api_key: str, base_url: str | None = None):
        self.base_url = base_url or "https://api.gladia.io"
        self.api_key = api_key

    def upload(self, audio_url: str):
        return httpx.post(f"{self.base_url}/v2/upload", json={"audio_url": audio_url}, headers={"x-gladia-key": self.api_key})


class ElevenLabs:
    BASE = "https://api.elevenlabs.io"

    def __init__(self, base_url: str = "https://api.elevenlabs.io/v1"):
        self.base_url = base_url

    def voices(self):
        return httpx.get(self.base_url + "/voices")

    def models(self):
        return httpx.get(self.BASE + "/v1/models")
