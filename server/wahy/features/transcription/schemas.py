"""What the transcription API sends and receives."""

from __future__ import annotations

from typing import Annotated
from urllib.parse import urlparse

from pydantic import AfterValidator, BaseModel, Field

from wahy.core.jobs import JobSnapshot
from wahy.features.lectures.schemas import LectureSummary


def _http_url(value: str) -> str:
    """Only web links: yt-dlp would also try local paths and other schemes."""
    parts = urlparse(value.strip())
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError("must be an http(s) link")
    return value.strip()


class ModelInfo(BaseModel):
    id: str
    label: str
    kind: str                       # "cloud" | "local"
    available: bool
    reason: str | None = None       # why it is not available
    default: bool = False


class TranscribeOptions(BaseModel):
    model: str | None = Field(None, description="a model id from /api/transcription/models; default: Groq "
                                                "when its key is set, else local small")
    auto_fallback: bool = Field(True, description="when the model fails, try the next one (Groq, then local "
                                                  "turbo, then local small)")


class YoutubeRequest(TranscribeOptions):
    url: Annotated[str, AfterValidator(_http_url)]
    title: str | None = None


class Started(BaseModel):
    """A lecture and the transcription job that is filling it; follow the job at /api/jobs/{id}/events."""

    lecture: LectureSummary
    job: JobSnapshot
