"""HTTP for the corpus: hadith sources (list, prepare, upload, delete, choose), the adhkar list, custom quotes
and what the engine has loaded. Preparing a source is a job: follow it at GET /api/jobs/{id}/events."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile

from wahy.core.engine import EngineError
from wahy.features.corpora.schemas import (
    ActivateRequest,
    AdhkarImport,
    AdhkarImported,
    BrowsePage,
    CorpusInfo,
    DhikrIn,
    DhikrOut,
    PrepareRequest,
    QuoteIn,
    QuoteOut,
    SourceOut,
    Started,
)
from wahy.features.corpora.service import BadInput, Conflict, CorporaService, NotFound
from wahy.features.corpora.sources import AlreadyPreparing, SourceError, UnknownSource

router = APIRouter(prefix="/api/corpora", tags=["corpora"])

MAX_UPLOAD_BYTES = 200 * 1024 * 1024


def get_corpora(request: Request) -> CorporaService:
    return request.app.state.corpora


Corpora = Annotated[CorporaService, Depends(get_corpora)]


@contextmanager
def corpora_errors() -> Iterator[None]:
    """The corpus errors as HTTP answers: 404 not found, 422 unusable input, 409 can't now, 400 a bad file."""
    try:
        yield
    except (NotFound, UnknownSource) as e:
        raise HTTPException(404, f"not found: {e}") from None
    except BadInput as e:
        raise HTTPException(422, str(e)) from None
    except (Conflict, AlreadyPreparing) as e:
        raise HTTPException(409, str(e)) from None
    except SourceError as e:
        raise HTTPException(400, str(e)) from None
    except EngineError as e:
        raise HTTPException(503, f"the engine failed: {e}") from None


@router.get("/info")
def corpus_info(corpora: Corpora) -> CorpusInfo:
    """What the engine has loaded: the Quran and hadith counts and the engine's fingerprint. The first call
    starts the engine worker, which takes a few seconds."""
    with corpora_errors():
        return corpora.info()


@router.get("/browse")
def browse(corpora: Corpora, kind: Annotated[str, Query(pattern="^(QURAN|HADITH)$")], surah: int | None = None,
           book: str | None = None, q: str = "", offset: Annotated[int, Query(ge=0)] = 0,
           limit: Annotated[int, Query(ge=1, le=200)] = 25) -> BrowsePage:
    """Read the Quran (filter: surah) or the hadith in use (filter: book), with a text or reference search and
    pages. Straight from the corpus: the first call starts the engine worker (seconds)."""
    with corpora_errors():
        return corpora.browse(kind, surah=surah, book=book, q=q, offset=offset, limit=limit)


# ---- hadith sources --------------------------------------------------------------------------

@router.get("/sources")
def list_sources(corpora: Corpora) -> list[SourceOut]:
    return corpora.list_sources()


@router.post("/sources/{source_id}/prepare", status_code=202)
def prepare_source(source_id: str, corpora: Corpora, body: PrepareRequest | None = None) -> Started:
    with corpora_errors():
        return Started(job=corpora.start_prepare(source_id, redownload=bool(body and body.redownload)))


@router.post("/sources/{source_id}/upload", status_code=202)
def upload_source(source_id: str, corpora: Corpora, file: Annotated[UploadFile, File()]) -> Started:
    """For when the download is blocked: upload the release zip by hand; the source is prepared from it."""
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"the file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    with corpora_errors():
        return Started(job=corpora.save_upload(source_id, data))


@router.delete("/sources/{source_id}", status_code=204)
def delete_source(source_id: str, corpora: Corpora, keep_download: bool = False) -> None:
    """Forget a prepared source and its cached download (the engine goes back to the built-in hadiths if it
    was the one in use). Prepare it again to download it afresh."""
    with corpora_errors():
        corpora.delete_source(source_id, keep_download=keep_download)


@router.put("/active-hadith-source")
def choose_hadith_source(body: ActivateRequest, corpora: Corpora) -> SourceOut:
    """Choose which hadith source the engine searches. A source that is not prepared is refused (409)."""
    with corpora_errors():
        return corpora.activate(body.source_id)


# ---- adhkar ------------------------------------------------------------------------------

@router.get("/adhkar")
def list_adhkar(corpora: Corpora) -> list[DhikrOut]:
    return corpora.list_adhkar()


@router.post("/adhkar", status_code=201)
def add_dhikr(body: DhikrIn, corpora: Corpora) -> DhikrOut:
    return corpora.add_dhikr(body)


@router.post("/adhkar/import")
def import_adhkar(body: AdhkarImport, corpora: Corpora) -> AdhkarImported:
    """Add the items of an exported list that are not in the list already."""
    return corpora.import_adhkar(body.items)


@router.post("/adhkar/reset")
def reset_adhkar(corpora: Corpora) -> list[DhikrOut]:
    """Back to the 18 initial adhkar; every other row (added or edited) is removed."""
    return corpora.reset_adhkar()


@router.put("/adhkar/{dhikr_id}")
def update_dhikr(dhikr_id: str, body: DhikrIn, corpora: Corpora) -> DhikrOut:
    with corpora_errors():
        return corpora.update_dhikr(dhikr_id, body)


@router.delete("/adhkar/{dhikr_id}", status_code=204)
def delete_dhikr(dhikr_id: str, corpora: Corpora) -> None:
    with corpora_errors():
        corpora.delete_dhikr(dhikr_id)


# ---- custom quotes --------------------------------------------------------------------------

@router.get("/custom-quotes")
def list_quotes(corpora: Corpora) -> list[QuoteOut]:
    return corpora.list_quotes()


@router.post("/custom-quotes", status_code=201)
def add_quote(body: QuoteIn, corpora: Corpora) -> QuoteOut:
    with corpora_errors():
        return corpora.add_quote(body)


@router.put("/custom-quotes/{quote_id}")
def update_quote(quote_id: str, body: QuoteIn, corpora: Corpora) -> QuoteOut:
    with corpora_errors():
        return corpora.update_quote(quote_id, body)


@router.delete("/custom-quotes/{quote_id}", status_code=204)
def delete_quote(quote_id: str, corpora: Corpora) -> None:
    with corpora_errors():
        corpora.delete_quote(quote_id)
