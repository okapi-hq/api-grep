from dataclasses import dataclass
from functools import lru_cache

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="NOTES_")

    chat_model: str = "gpt-4o-mini"
    summary_model: str = Field("gpt-4.1-mini", description="summaries")
    embedding_model: str = Field(default="text-embedding-3-small", alias="EMBEDDINGS")
    groq_model: str


class LegacySettings(BaseSettings):
    vision_model: str = "gpt-4o"

    class Config:
        env_prefix = "LEGACY_"


class Reply(BaseModel):
    model: str = "claude-3-5-haiku-latest"


@dataclass(kw_only=True)
class Workflow:
    writer_model: str = "claude-sonnet-4-5"
    planner_model: str = "o3-mini"

    @classmethod
    def from_config(cls, config: dict | None = None) -> "Workflow":
        values = (config or {}).get("configurable", {})
        return cls(**{k: v for k, v in values.items() if v})


settings = AppSettings()


@lru_cache
def get_settings() -> AppSettings:
    return AppSettings()
