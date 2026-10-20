"""
Unit of Work abstraction for AI Tafrigh Phase.
Partitions transcripts into non-overlapping scheduling units with read-only context.
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from .models import HeadingEntry, OutlineState, TranscriptSegment


class UnitOfWork(BaseModel):
    uow_id: str = Field(default_factory=lambda: f"uow_{uuid.uuid4().hex[:8]}")
    target_segments: List[TranscriptSegment]
    context_before: List[TranscriptSegment] = Field(default_factory=list)
    context_after: List[TranscriptSegment] = Field(default_factory=list)
    partial_toc: List[Dict[str, Any]] = Field(default_factory=list)
    current_position_index: int = 0
    last_confirmed_heading: Optional[HeadingEntry] = None
    allowed_choices: List[Dict[str, Any]] = Field(default_factory=list)


def build_units_of_work(
    segments: List[TranscriptSegment],
    mode: Literal["per_sentence", "windowed"] = "per_sentence",
    window_size: int = 20,
    context_before: int = 3,
    context_after: int = 3,
    outline_state: Optional[OutlineState] = None,
) -> List[UnitOfWork]:
    """
    Partitions segments into non-overlapping target_segments slices so that
    every segment is owned by exactly one UnitOfWork.
    """
    if not segments:
        return []

    step = 1 if mode == "per_sentence" else max(1, window_size)
    uows: List[UnitOfWork] = []
    total = len(segments)

    for i in range(0, total, step):
        targets = segments[i : min(i + step, total)]

        c_before = segments[max(0, i - context_before) : i]
        c_after = segments[min(i + step, total) : min(i + step + context_after, total)]

        toc = outline_state.get_partial_toc() if outline_state else []
        last_h = outline_state.headings[-1] if outline_state and outline_state.headings else None
        choices = outline_state.get_allowed_structural_choices() if outline_state else []

        uow = UnitOfWork(
            uow_id=f"uow_{i // step:04d}",
            target_segments=targets,
            context_before=c_before,
            context_after=c_after,
            partial_toc=toc,
            current_position_index=i,
            last_confirmed_heading=last_h,
            allowed_choices=choices,
        )
        uows.append(uow)

    return uows
