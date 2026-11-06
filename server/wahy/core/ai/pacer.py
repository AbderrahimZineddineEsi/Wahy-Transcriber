"""The free-tier pacer: at most N requests in any 60 seconds (Gemini's free plan allows about 10 to 15 a
minute).

    pacer = Pacer()
    pacer.take(limit=5, call=call, sleep=time.sleep)   # returns at once, or waits until a slot is free

It keeps the start times of the requests of the last minute (a sliding window). When the window is full it
waits until the oldest one is a minute old (plus half a second), telling `call.on_wait` how long. One pacer is
shared by every job of the process, because the limit belongs to the key, not to a job. Thread-safe.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Callable

from wahy.core.ai.http import interruptible_wait
from wahy.core.ai.types import Call

WINDOW_S = 60.0
MARGIN_S = 0.5


class Pacer:
    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self._clock = clock
        self._lock = threading.Lock()
        self._starts: deque[float] = deque()

    def take(self, *, limit: int, call: Call, sleep: Callable[[float], None] = time.sleep) -> None:
        """Wait for a free slot in the window, then use it."""
        limit = max(1, int(limit))
        while True:
            with self._lock:
                now = self._clock()
                while self._starts and self._starts[0] <= now - WINDOW_S:
                    self._starts.popleft()
                if len(self._starts) < limit:
                    self._starts.append(now)
                    return
                wait = self._starts[0] + WINDOW_S - now + MARGIN_S
            if call.on_wait:
                call.on_wait(wait, f"free tier: at most {limit} requests a minute")
            interruptible_wait(wait, call, sleep)

    def recent(self) -> int:
        """How many requests started in the last minute."""
        with self._lock:
            now = self._clock()
            return sum(1 for t in self._starts if t > now - WINDOW_S)
