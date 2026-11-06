"""Read and write the app settings table (features/settings/models.py): small JSON values by key.

    store = SettingsStore(db)
    store.set("detection", {"engine": "v5:loose"})
    store.get("detection", {})            # the saved value, or the default when nothing was saved
"""

from __future__ import annotations

from typing import Any

from wahy.core.db import Database
from wahy.features.settings.models import AppSetting


class SettingsStore:
    def __init__(self, db: Database):
        self.db = db

    def get(self, key: str, default: Any = None) -> Any:
        with self.db.session() as s:
            row = s.get(AppSetting, key)
            return default if row is None else row.value

    def set(self, key: str, value: Any) -> None:
        with self.db.session() as s:
            row = s.get(AppSetting, key)
            if row is None:
                s.add(AppSetting(key=key, value=value))
            else:
                row.value = value
