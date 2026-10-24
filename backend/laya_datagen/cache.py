"""Content-addressed on-disk cache; writes are atomic so an interrupted run never leaves a half file."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Optional

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "laya_datagen"


def sha(*parts: Any) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p if isinstance(p, bytes) else json.dumps(p, sort_keys=True, ensure_ascii=False).encode())
        h.update(b"\x00")
    return h.hexdigest()[:24]


def write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    tmp.write_bytes(data)
    os.replace(tmp, path)


class JsonCache:
    def __init__(self, sub: str, root: Optional[Path] = None):
        self.dir = (root or DATA_DIR) / "cache" / sub

    def _p(self, key: str) -> Path:
        return self.dir / f"{key}.json"

    def get(self, key: str) -> Optional[Any]:
        p = self._p(key)
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

    def put(self, key: str, value: Any) -> None:
        write_atomic(self._p(key), json.dumps(value, ensure_ascii=False).encode("utf-8"))
