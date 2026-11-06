"""Paths and API keys, read once from the environment and the gitignored `.env` at the repo root.

Every path the server writes to comes from here, so a test can point the whole server at a temporary folder:

    settings = Settings(data_dir=tmp_path, _env_file=None)

API keys are `SecretStr`: printing or logging the settings shows `**********`, never the key. The web app only
ever learns whether a key is set (`key_status()`), never its value.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]

# the provider name the web app shows → the settings field that holds its key
KEY_FIELDS = {"groq": "groq_api_key", "gemini": "gemini_api_key", "openrouter": "openrouter_api_key",
              "jev": "jev_api_key"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", extra="ignore",
                                      populate_by_name=True)

    # where everything the app stores lives (git-ignored, ADR 0005)
    data_dir: Path = Field(REPO_ROOT / "data", validation_alias="WAHY_DATA_DIR")
    # these default to files inside data_dir; set them to put one file somewhere else
    db_path: Path | None = Field(None, validation_alias="WAHY_DB_PATH")
    corpus_path: Path | None = Field(None, validation_alias="WAHY_CORPUS_PATH")
    media_dir: Path | None = Field(None, validation_alias="WAHY_MEDIA_DIR")

    # the engine worker (ADR 0002): heap at most 3.5 GB on the 15 GB laptop
    node: str = Field("node", validation_alias="WAHY_NODE")
    engine_max_heap_mb: int = Field(3584, validation_alias="WAHY_ENGINE_MAX_HEAP_MB")
    engine_timeout_s: float = Field(900.0, validation_alias="WAHY_ENGINE_TIMEOUT_S")

    groq_api_key: SecretStr | None = Field(None, validation_alias="GROQ_API_KEY")
    gemini_api_key: SecretStr | None = Field(None, validation_alias="GEMINI_API_KEY")
    openrouter_api_key: SecretStr | None = Field(None, validation_alias="OPENROUTER_API_KEY")
    jev_api_key: SecretStr | None = Field(None, validation_alias="JEV_API_KEY")

    @model_validator(mode="after")
    def _fill_paths(self) -> Settings:
        self.data_dir = self.data_dir.resolve()
        self.db_path = (self.db_path or self.data_dir / "wahy.db").resolve()
        self.corpus_path = (self.corpus_path or self.data_dir / "corpus.json").resolve()
        self.media_dir = (self.media_dir or self.data_dir / "media").resolve()
        return self

    def key(self, provider: str) -> str | None:
        """The key for `provider` ("groq", "gemini", ...), or None when it is not set. Only core/ai reads
        keys."""
        secret: SecretStr | None = getattr(self, KEY_FIELDS[provider])
        value = secret.get_secret_value().strip() if secret else ""
        return value or None

    def key_status(self) -> dict[str, bool]:
        """Which keys are set: {"groq": True, "gemini": False, ...}. Safe to send to the browser."""
        return {provider: self.key(provider) is not None for provider in KEY_FIELDS}


@lru_cache
def get_settings() -> Settings:
    """The settings, read once per process."""
    return Settings()
