"""HTTP for the editor: word and text edits, finding edits, the caption timing editor, the edit log and undo.
It
only translates HTTP to `EditingService` calls."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Request

from wahy.core.engine import EngineError
from wahy.features.editing.schemas import (
    AddQuote,
    CaptionEdit,
    CaptionEditOut,
    DeleteIntent,
    EditDone,
    FindingEdit,
    OpOut,
    ReplaceText,
    ReplaceWords,
    Undone,
)
from wahy.features.editing.service import BadEdit, EditError, EditingService, NothingChanged, NothingToUndo
from wahy.features.lectures.schemas import WordEdit, WordOut
from wahy.features.lectures.service import BadLectureInput, LectureNotFound, WordNotFound
from wahy.features.verification.service import FindingNotFound

router = APIRouter(tags=["editing"])


def get_editing(request: Request) -> EditingService:
    return request.app.state.editing


Editing = Annotated[EditingService, Depends(get_editing)]


@contextmanager
def editing_errors() -> Iterator[None]:
    """404 no such lecture, finding or word; 422 unusable input; 409 the edit can't be made now (or changes
    nothing, or there is nothing to undo); 503 the engine failed."""
    try:
        yield
    except (LectureNotFound, WordNotFound) as e:
        raise HTTPException(404, f"not found: {e}") from None
    except FindingNotFound as e:
        raise HTTPException(404, str(e.args[0] if e.args else e)) from None
    except (BadEdit, BadLectureInput) as e:
        raise HTTPException(422, str(e)) from None
    except (NothingChanged, NothingToUndo, EditError) as e:
        raise HTTPException(409, str(e)) from None
    except EngineError as e:
        raise HTTPException(503, f"engine: {str(e).splitlines()[0] if str(e) else e}") from None


# ---- the log
# -------------------------------------------------------------------------------------------------------


@router.get("/api/lectures/{lecture_id}/edits")
def edit_log(lecture_id: int, service: Editing) -> list[OpOut]:
    """The lecture's edits, newest first."""
    with editing_errors():
        return service.log(lecture_id)


@router.post("/api/lectures/{lecture_id}/edits/undo")
def undo(lecture_id: int, service: Editing) -> Undone:
    """Undo the newest edit (F-003); the answer names it."""
    with editing_errors():
        return service.undo(lecture_id)


# ---- words
# ---------------------------------------------------------------------------------------------------------


@router.patch("/api/lectures/{lecture_id}/words/{idx}")
def edit_word(lecture_id: int, idx: int, body: WordEdit, service: Editing) -> WordOut:
    """Correct one word's text (F-041); its timing and the findings stay. Undo puts it back."""
    with editing_errors():
        return service.edit_word(lecture_id, idx, body.text)


@router.post("/api/lectures/{lecture_id}/edits/words")
def replace_words(lecture_id: int, body: ReplaceWords, service: Editing) -> EditDone:
    """Rewrite or delete some words (F-056)."""
    with editing_errors():
        return service.replace_words(lecture_id, body)


@router.put("/api/lectures/{lecture_id}/edits/text")
def replace_text(lecture_id: int, body: ReplaceText, service: Editing) -> EditDone:
    """Save the full-text editor (F-067)."""
    with editing_errors():
        return service.replace_text(lecture_id, body)


# ---- findings
# ------------------------------------------------------------------------------------------------------


@router.post("/api/lectures/{lecture_id}/edits/quote", status_code=201)
def add_quote(lecture_id: int, body: AddQuote, service: Editing) -> EditDone:
    """Insert a missed quote (F-053)."""
    with editing_errors():
        return service.add_quote(lecture_id, body)


@router.post("/api/findings/{finding_id}/edit")
def edit_finding(finding_id: int, body: Annotated[FindingEdit, Body()], service: Editing) -> EditDone:
    """One change to a finding: move an edge, change its kind, the source text or the reference's words,
    its references, merge with a neighbour (F-058 to F-063)."""
    with editing_errors():
        return service.edit_finding(finding_id, body)


@router.delete("/api/findings/{finding_id}")
def delete_finding(finding_id: int, intent: DeleteIntent, service: Editing) -> EditDone:
    """Delete a finding, saying why (F-064): `ordinary_speech` saves a gold label "false"."""
    with editing_errors():
        return service.delete_finding(finding_id, intent)


# ---- captions
# ------------------------------------------------------------------------------------------------------


@router.get("/api/lectures/{lecture_id}/edits/captions")
def caption_edits(lecture_id: int, service: Editing) -> list[CaptionEditOut]:
    """The caption timing editor's saved edits, in the order they apply (the web app's caption preview applies
    them too)."""
    with editing_errors():
        return [CaptionEditOut.model_validate(e) for e in service.caption_edits(lecture_id)]


@router.post("/api/lectures/{lecture_id}/edits/captions")
def edit_caption(lecture_id: int, body: CaptionEdit, service: Editing) -> EditDone:
    """Split, merge or re-time a caption (F-068). Quotes are locked units (409)."""
    with editing_errors():
        return service.edit_caption(lecture_id, body)
