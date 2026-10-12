import os


class Settings:
    summary_model: str = os.getenv("SUMMARY_MODEL", "gpt-4o-mini")
    vision_model = os.environ.get("VISION_MODEL", "claude-3-5-sonnet-20241022")


settings = Settings()

CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-4.1")
TRANSCRIBE_MODEL = os.getenv("TRANSCRIBE_MODEL", "whisper-1").strip()


def reasoning_model():
    return os.getenv("REASONING_MODEL", "o3-mini")
