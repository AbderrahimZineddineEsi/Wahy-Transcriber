"""HTTP for exports: the saved style, a lecture's export files and its captions. It only translates HTTP to
`ExportService` calls."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from wahy.features.editing.schemas import CaptionOut
from wahy.features.export.schemas import (
    ExportFormat,
    ExportStyle,
    ExportStylePatch,
    Kind,
    Script,
    VerdictShown,
)
from wahy.features.export.service import ALL_VERDICTS, ExportService
from wahy.features.lectures.service import LectureNotFound

router = APIRouter(tags=["export"])


def get_export(request: Request) -> ExportService:
    return request.app.state.export


Export = Annotated[ExportService, Depends(get_export)]
Show = Annotated[
    list[VerdictShown] | None,
    Query(description="the verdicts shown as quotes (NONE = unverified); empty: all"),
]


@router.get("/api/export/style")
def get_style(service: Export) -> ExportStyle:
    """Brackets and references (F-071)."""
    return service.style()


@router.patch("/api/export/style")
def update_style(body: ExportStylePatch, service: Export) -> ExportStyle:
    return service.update_style(body)


@router.get(
    "/api/lectures/{lecture_id}/export/{fmt}",
    responses={200: {"content": {"text/plain": {}}, "description": "the file"}},
)
def export_file(
    lecture_id: int,
    fmt: ExportFormat,
    service: Export,
    script: Script = "spoken",
    show: Show = None,
    kind: Kind = "all",
) -> Response:
    """One export file (F-069, F-070), as a download."""
    try:
        f = service.file(lecture_id, fmt, script=script, show=set(show) if show else ALL_VERDICTS, kind=kind)
    except LectureNotFound as e:
        raise HTTPException(404, f"no lecture {e}") from None
    return Response(
        f["content"],
        media_type=f"{f['mime']}; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{f["filename"]}"'},
    )


@router.get("/api/lectures/{lecture_id}/captions")
def lecture_captions(
    lecture_id: int, service: Export, script: Script = "spoken", show: Show = None, kind: Kind = "all"
) -> list[CaptionOut]:
    """The captions as the caption files write them, with the timing editor's edits (F-068)."""
    try:
        caps = service.captions(
            lecture_id, script=script, show=set(show) if show else ALL_VERDICTS, kind=kind
        )
    except LectureNotFound as e:
        raise HTTPException(404, f"no lecture {e}") from None
    return [CaptionOut.model_validate(c) for c in caps]
