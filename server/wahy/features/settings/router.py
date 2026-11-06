"""HTTP for health and settings. Keys go in (PUT) and never come out: the answer only says which are set."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from wahy.core.ai.gemini import pick_model
from wahy.core.ai.layer import AiLayer
from wahy.core.ai.openrouter import CATEGORIES
from wahy.core.ai.types import AiError
from wahy.features.settings.schemas import (
    GeminiModels,
    Health,
    KeyUpdate,
    LayaLoad,
    LayaStatusOut,
    OpenRouterModel,
)
from wahy.features.settings.service import SettingsService

router = APIRouter(prefix="/api", tags=["settings"])


def get_settings_service(request: Request) -> SettingsService:
    return request.app.state.settings_service


Service = Annotated[SettingsService, Depends(get_settings_service)]


@router.get("/health")
def health(service: Service) -> Health:
    return service.health()


@router.put("/settings/keys/{provider}")
def save_key(provider: str, body: KeyUpdate, service: Service) -> dict[str, bool]:
    """Save one provider's key in the server's .env (empty removes it). Answers which keys are set."""
    try:
        return service.set_key(provider, body.value)
    except KeyError:
        raise HTTPException(404, f"unknown provider {provider!r}") from None
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


# ---- AI providers: model lists and Laya (core/ai, ADR 0004) ------------------------------------------------

def get_ai(request: Request) -> AiLayer:
    return request.app.state.ai


Ai = Annotated[AiLayer, Depends(get_ai)]


def _http_error(e: AiError) -> HTTPException:
    """424 when our side must change something (a missing or wrong key, an unknown model), 502 when the
    provider failed or could not be reached."""
    ours = e.fatal if e.status is None else e.status < 500
    return HTTPException(424 if ours else 502, str(e))


@router.get("/settings/ai/openrouter/models")
def openrouter_models(ai: Ai, q: str = "", category: str = "all", refresh: bool = False,
                      limit: int = 60) -> list[OpenRouterModel]:
    """Search OpenRouter's whole catalog with live prices (F-083). `category`: all, jev, gemini, chinese,
    free."""
    if category not in CATEGORIES:
        raise HTTPException(422, f"unknown category {category!r}; use one of {', '.join(CATEGORIES)}")
    try:
        if refresh:
            ai.catalog.models(refresh=True)
        return [OpenRouterModel(**m.as_dict()) for m in ai.catalog.search(q, category=category, limit=limit)]
    except AiError as e:
        raise _http_error(e) from None


@router.get("/settings/ai/gemini/models")
def gemini_models(ai: Ai) -> GeminiModels:
    """The Gemini models the saved key can call (F-081 "fetch models available to my key")."""
    try:
        names = ai.gemini.list_models()
    except AiError as e:
        raise _http_error(e) from None
    return GeminiModels(models=sorted(names), recommended=pick_model(names))


@router.get("/settings/laya")
def laya_status(ai: Ai) -> LayaStatusOut:
    """Loaded or not, device, VRAM, the checkpoint and the envelope version it reads (F-097)."""
    return LayaStatusOut(**ai.laya.status().as_dict())


@router.post("/settings/laya/load")
def laya_load(body: LayaLoad, ai: Ai) -> LayaStatusOut:
    """Load a checkpoint on a device (F-098); waits while another job uses the GPU, which unloads Whisper."""
    try:
        return LayaStatusOut(**ai.laya.load(body.checkpoint, body.device).as_dict())
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    except AiError as e:
        raise _http_error(e) from None


@router.post("/settings/laya/unload")
def laya_unload(ai: Ai) -> LayaStatusOut:
    """Unload Laya to free the GPU (F-098)."""
    return LayaStatusOut(**ai.laya.unload().as_dict())
