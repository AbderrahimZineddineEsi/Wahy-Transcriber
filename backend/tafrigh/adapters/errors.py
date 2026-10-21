"""Errors shared by all model adapters, and secret redaction for anything that leaves the backend."""

from __future__ import annotations

import re
from typing import Any, Optional

_SECRET_RE = re.compile(
    r"(key=|x-goog-api-key[\"':\s=]+|bearer\s+)[A-Za-z0-9_\-\.]{12,}|sk-or-v1-[A-Za-z0-9]{16,}", re.I
)


def redact_secrets(text: Any) -> str:
    """Strip API keys out of any message before it is logged, returned to the UI or put in a bug report."""
    return _SECRET_RE.sub(lambda m: (m.group(1) + "***") if m.group(1) else "sk-or-***", str(text))


class ModelAPIError(RuntimeError):
    """A model call failed. `status` is the HTTP status (None for network/parse errors); `retryable` hints at transient faults."""

    def __init__(self, message: str, status: Optional[int] = None, retryable: bool = False) -> None:
        super().__init__(redact_secrets(message))
        self.status = status
        self.retryable = retryable
