"""Small helpers for tests."""

from __future__ import annotations

import time
from collections.abc import Callable


def wait_for(condition: Callable[[], bool], timeout: float = 5.0, what: str = "condition") -> None:
    """Poll until `condition()` is true; fail the test after `timeout` seconds."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(0.005)
    raise AssertionError(f"timed out waiting for {what}")
