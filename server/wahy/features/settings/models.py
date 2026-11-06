"""App settings the user changes in the web app (engine choice, verifier options, ...). Not API keys: those
stay in `.env` and are read by core/settings.py."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column

from wahy.core.db import Base, utcnow


class AppSetting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
