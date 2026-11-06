"""What the export API sends and receives (ROADMAP phase 16; F-069, F-070, F-071)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ExportFormat = Literal["srt", "vtt", "ass", "md", "txt", "json", "html"]
Script = Literal["spoken", "standard"]
Kind = Literal["all", "quran", "hadith", "dhikr"]
VerdictShown = Literal["CORRECT", "NOT_SURE", "FALSE", "NONE"]


class ExportStyle(BaseModel):
    """How quotes are written in the exports and the captions (F-071), remembered between sessions. The names
    are the old app's output preferences, so the engine reads them as they are."""

    quranBracketOpen: str = Field("﴿", max_length=8)
    quranBracketClose: str = Field("﴾", max_length=8)
    hadithBracketOpen: str = Field("«", max_length=8)
    hadithBracketClose: str = Field("»", max_length=8)
    adhkarBracketOpen: str = Field("〖", max_length=8)
    adhkarBracketClose: str = Field("〗", max_length=8)
    groupContiguousAyat: bool = Field(True, description="write a run of consecutive ayat once: البقرة: 1-5")
    showQuranSource: bool = Field(
        True, description="for the screen; the exports always write references, as the old app did"
    )
    showHadithSource: bool = True
    showAdhkarTag: bool = True
    splitCommentary: bool = Field(
        True,
        description="put a quote's commentary gaps outside its brackets: "
        "«part one» [commentary] «part two» [ref]",
    )


class ExportStylePatch(BaseModel):
    quranBracketOpen: str | None = Field(None, max_length=8)
    quranBracketClose: str | None = Field(None, max_length=8)
    hadithBracketOpen: str | None = Field(None, max_length=8)
    hadithBracketClose: str | None = Field(None, max_length=8)
    adhkarBracketOpen: str | None = Field(None, max_length=8)
    adhkarBracketClose: str | None = Field(None, max_length=8)
    groupContiguousAyat: bool | None = None
    showQuranSource: bool | None = None
    showHadithSource: bool | None = None
    showAdhkarTag: bool | None = None
    splitCommentary: bool | None = None
