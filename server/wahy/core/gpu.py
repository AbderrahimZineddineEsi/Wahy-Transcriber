"""The GPU owner (ADR 0006): the only code that loads models onto the GPU. Only one model is resident at a
time, because the GTX 1050 has 3 GB.

Features register how to load and unload each model once, then borrow it:

    gpu.register("whisper", load=lambda: WhisperModel("large-v3-turbo", device="cuda"))
    gpu.register("laya", load=load_laya, unload=lambda m: m.close())

    with gpu.use("laya", should_stop=ctx.check) as laya:   # waits while another job uses the GPU
        verdicts = laya.predict(envelopes)

`use()` gives the GPU to one caller at a time. If another model is resident it is unloaded first, and the
memory is freed (garbage collection, then torch's CUDA cache). After `use()` the model stays resident, so the
next job that asks for the same model starts at once. While a caller waits it calls `should_stop()` every so
often: a job passes `ctx.check`, so pausing or cancelling a job that is waiting for the GPU works.

The loaders decide the device (CUDA, or the CPU fallback); the owner only makes sure that two models are never
on the GPU together.
"""

from __future__ import annotations

import gc
import logging
import sys
import threading
from collections import Counter
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

log = logging.getLogger("wahy.gpu")


class GpuError(RuntimeError):
    pass


@dataclass
class _Model:
    load: Callable[[], Any]
    unload: Callable[[Any], None] | None


@dataclass(frozen=True)
class GpuStatus:
    resident: str | None          # the model loaded now
    in_use: str | None            # the model a caller is using now
    waiting: list[str]            # models callers are waiting for


def free_cuda_memory() -> None:
    """Return freed memory to the GPU. torch is only touched when something already imported it."""
    gc.collect()
    torch = sys.modules.get("torch")
    if torch is not None and torch.cuda.is_available():
        torch.cuda.empty_cache()


class GpuOwner:
    def __init__(self, *, free_memory: Callable[[], None] = free_cuda_memory, poll_s: float = 0.25):
        self._models: dict[str, _Model] = {}
        self._free_memory = free_memory
        self._poll_s = poll_s
        self._cond = threading.Condition()
        self._in_use: str | None = None
        self._holder: int | None = None           # the thread using the GPU now
        self._waiting: Counter[str] = Counter()
        self._resident: str | None = None
        self._model: Any = None

    def register(self, name: str, load: Callable[[], Any],
                 unload: Callable[[Any], None] | None = None) -> None:
        """How to load `name` (returns the model object) and how to release it (optional: by default the owner
        drops its reference and frees memory)."""
        self._models[name] = _Model(load, unload)

    @contextmanager
    def use(self, name: str, *, should_stop: Callable[[], None] | None = None) -> Iterator[Any]:
        """Wait for the GPU, make `name` the resident model, and yield it. One caller at a time."""
        if name not in self._models:
            known = ", ".join(sorted(self._models)) or "none"
            raise GpuError(f"unknown model {name!r} (registered: {known})")
        self._acquire(name, should_stop)
        try:
            yield self._make_resident(name)
        finally:
            self._release()

    def load(self, name: str, *, should_stop: Callable[[], None] | None = None) -> None:
        """Make `name` resident now (the "load Laya" button), so the next `use()` starts at once."""
        with self.use(name, should_stop=should_stop):
            pass

    def unload(self, *, should_stop: Callable[[], None] | None = None) -> str | None:
        """Free the GPU (the "unload" button): waits for the current user, then unloads. Returns what was
        resident."""
        self._acquire("(unload)", should_stop)
        try:
            unloaded = self._resident
            self._unload_resident()
            return unloaded
        finally:
            self._release()

    def status(self) -> GpuStatus:
        with self._cond:
            return GpuStatus(self._resident, self._in_use, sorted(self._waiting.elements()))

    # ---- inside --------------------------------------------------------------------------------------------

    def _acquire(self, name: str, should_stop: Callable[[], None] | None) -> None:
        me = threading.get_ident()
        with self._cond:
            if self._holder == me:
                raise GpuError(f"this thread already uses the GPU for {self._in_use!r}; "
                               "leave that block first")
            self._waiting[name] += 1
        try:
            while True:
                with self._cond:
                    if self._in_use is None:
                        self._in_use, self._holder = name, me
                        return
                    self._cond.wait(self._poll_s)
                if should_stop is not None:
                    # outside the lock: it may block (a paused job) or raise (a cancelled one)
                    should_stop()
        finally:
            with self._cond:
                self._waiting[name] -= 1
                if self._waiting[name] <= 0:
                    del self._waiting[name]

    def _release(self) -> None:
        with self._cond:
            self._in_use = self._holder = None
            self._cond.notify_all()

    def _make_resident(self, name: str) -> Any:
        if self._resident == name:
            return self._model
        self._unload_resident()
        log.info("loading %s onto the GPU", name)
        try:
            model = self._models[name].load()
        except BaseException:
            self._free_memory()          # a half-loaded model must not stay in memory
            raise
        with self._cond:
            self._resident, self._model = name, model
        return model

    def _unload_resident(self) -> None:
        if self._resident is None:
            return
        name, model = self._resident, self._model
        with self._cond:
            self._resident = self._model = None
        log.info("unloading %s from the GPU", name)
        try:
            unload = self._models[name].unload
            if unload is not None:
                unload(model)
        finally:
            del model
            self._free_memory()
