"""What the corpora API sends and receives."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from wahy.core.jobs import JobSnapshot


class SourceOut(BaseModel):
    """A hadith corpus source. `status`: ready | preparing | missing."""

    id: str
    label: str
    description: str
    builtin: bool
    page_url: str | None
    version: str | None
    status: str
    active: bool                       # the engine searches this one
    count: int | None                  # hadiths, when ready (not known for the built-in one)
    by_book: dict[str, int] | None
    built_at: str | None
    size_mb: float | None
    zip_cached: bool                   # the download is kept, so preparing again needs no network
    preparing_job: str | None


class PrepareRequest(BaseModel):
    redownload: bool = Field(False, description="throw the cached download away and fetch it again")


class ActivateRequest(BaseModel):
    source_id: str


class CorpusInfo(BaseModel):
    """What the engine has loaded. Starts the engine worker if it is not running (seconds)."""

    quran: int
    hadiths: int
    adhkar: int
    custom_quotes: int
    hadith_source: str
    fingerprint: dict[str, Any]


class DhikrIn(BaseModel):
    category: str = "أذكار متفرقة"
    ref: str
    t: str

    @field_validator("category", "ref", "t")
    @classmethod
    def _not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be empty")
        return v

    @field_validator("t")
    @classmethod
    def _two_words(cls, v: str) -> str:
        if len(v.split()) < 2:
            raise ValueError("a dhikr needs at least two words")
        return v


class AdhkarImport(BaseModel):
    """A JSON list of adhkar (the export of GET /adhkar, or just `{category?, ref?, t}` items)."""

    items: list[dict[str, Any]]


class AdhkarImported(BaseModel):
    added: int
    skipped: int = Field(description="empty, under two words, or already in the list (ignoring marks)")
    adhkar: list[DhikrOut]


class DhikrOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    category: str
    ref: str
    t: str
    is_custom: bool
    created_at: datetime


class QuoteIn(BaseModel):
    t: str = Field(description="the text, at least 4 characters")
    ref: str = "حديث خارج القاعدة"

    @field_validator("t", "ref")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class QuoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    ref: str
    t: str
    created_at: datetime


class Started(BaseModel):
    job: JobSnapshot


class BrowseItem(BaseModel):
    id: str
    ref: str
    text: str
    group: str


class BrowsePage(BaseModel):
    """One page of the Quran or a hadith book. `groups` are the filter choices: surah number → [name, ayat],
    or book id → [book id, hadiths]."""

    total: int
    items: list[BrowseItem]
    groups: dict[str, tuple[str, int]]
