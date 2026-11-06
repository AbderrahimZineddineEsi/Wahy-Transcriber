"""HTTP for health and settings. Keys go in (PUT) and never come out: the answer only says which are set."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from wahy.features.settings.schemas import Health, KeyUpdate
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
