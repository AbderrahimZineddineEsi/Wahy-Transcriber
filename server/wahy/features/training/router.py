"""HTTP for the training data (ROADMAP phase 20). It only translates HTTP to `TrainingService` calls."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response

from wahy.features.tafrigh.store import RunNotFound
from wahy.features.training.schemas import (
    Cleared,
    Imported,
    TafrighSaved,
    TafrighSaveIn,
    TrainingPage,
    TrainingRowJson,
)
from wahy.features.training.service import RowNotFound, TrainingError, TrainingService

router = APIRouter(prefix="/api/training", tags=["training"])


def get_training(request: Request) -> TrainingService:
    return request.app.state.training


Training = Annotated[TrainingService, Depends(get_training)]


@router.get("")
def training_page(
    service: Training,
    origin: Literal["all", "gold", "user", "approval", "legacy", "tafrigh", "ai"] = "all",
    task: Literal["all", "verification", "tafrigh"] = "all",
    label: Literal["ALL", "CORRECT", "FALSE", "NOT_SURE", "CLIPPED"] = "ALL",
    q: str | None = None,
    lecture_id: int | None = None,
    limit: Annotated[int, Query(ge=1, le=5000)] = 500,
) -> TrainingPage:
    """The training data (F-100, F-104): counters over every row, and the rows matching the filters, newest
    first. Each row says where it came from: the user's label (and how it was given), the old app's imported
    bank, a Tafrigh run, or a verifier's verdict."""
    return service.page(origin=origin, task=task, label=label, q=q, lecture_id=lecture_id, limit=limit)


@router.get("/rows/{row_id}")
def training_row(row_id: str, service: Training) -> TrainingRowJson:
    """The JSONL line one row writes (the inspector)."""
    try:
        return service.row_json(row_id)
    except RowNotFound:
        raise HTTPException(404, f"no training row {row_id}") from None


@router.get("/export", response_class=Response)
def export_training(
    service: Training,
    task: Literal["verification", "tafrigh"] = "verification",
    gold_only: bool = False,
) -> Response:
    """F-101: the Laya JSONL file (verification), written as the old app wrote it; or the Tafrigh examples."""
    name, text = service.export(task, gold_only=gold_only)
    return Response(
        content=text.encode("utf-8"),
        media_type="application/x-jsonlines; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.post("/import")
def import_training(service: Training, file: Annotated[UploadFile, File()]) -> Imported:
    """Import the old app's exported training bank (its Laya JSONL export) or a Tafrigh "save run" file. Rows
    already imported (same id) are replaced, not added twice."""
    raw = file.file.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "the file is not UTF-8 text") from None
    try:
        return service.import_text(text, file.filename or "upload")
    except TrainingError as e:
        raise HTTPException(400, str(e)) from None


@router.post("/import/legacy")
def import_legacy(service: Training) -> Imported:
    """Import every .jsonl / .json file in data/legacy/ (the old app's exports)."""
    try:
        return service.import_legacy_folder()
    except TrainingError as e:
        raise HTTPException(400, str(e)) from None


@router.delete("")
def clear_training(service: Training) -> Cleared:
    """F-103: delete every label. The verifiers' verdicts stay on their lectures but leave the training
    data."""
    return Cleared(deleted=service.clear())


@router.post("/tafrigh/{run_id}")
def save_tafrigh(run_id: str, body: TafrighSaveIn, service: Training) -> TafrighSaved:
    """F-120: save the chosen sentences of a Tafrigh run as Laya examples (saving again replaces them)."""
    try:
        return service.save_tafrigh(run_id, body)
    except RunNotFound:
        raise HTTPException(404, f"no Tafrigh run {run_id}") from None
    except TrainingError as e:
        raise HTTPException(400, str(e)) from None


@router.get("/tafrigh/{run_id}")
def tafrigh_saved(run_id: str, service: Training) -> TafrighSaved | None:
    """What a Tafrigh run has saved for Laya (null when nothing)."""
    try:
        return service.tafrigh_saved(run_id)
    except RunNotFound:
        raise HTTPException(404, f"no Tafrigh run {run_id}") from None
