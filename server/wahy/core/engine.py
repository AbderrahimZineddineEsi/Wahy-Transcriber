"""Client for the engine worker (ADR 0002): the TypeScript engine runs in a long-lived Node process
(engine/src/worker.ts) and this class is the server's only way to reach it.

    engine = EngineClient(settings.corpus_path)
    findings = engine.detect(words, {"engine": "v5", "profile": "normal"})
    envs = engine.envelopes(findings, words, 3, {"engine": "v5", "passages": True})
    refs = engine.search("البقرة: 255", {"engine": "v5", "kind": "QURAN"})

What it hides:
- **Start-up.** The worker starts on the first call. Loading the corpus and building a matcher take seconds;
the
  worker keeps both, so later calls are fast.
- **One request at a time.** Calls from several threads wait for each other (the worker answers in order
anyway).
- **Crashes.** If the worker dies, the call that was running raises EngineCrashed with the end of the worker's
  stderr, and the next call starts a fresh worker. A call that takes longer than `timeout_s` kills the worker
  (EngineTimeout), for the same fresh start.
- **The protocol.** One JSON request per line on stdin, one JSON answer per line on stdout (see worker.ts).
"""

from __future__ import annotations

import json
import logging
import queue
import subprocess
import threading
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from wahy.core.settings import REPO_ROOT, Settings

log = logging.getLogger("wahy.engine")

WORKER = REPO_ROOT / "engine" / "src" / "worker.ts"
_EOF = object()


class EngineError(RuntimeError):
    """The worker answered with an error (a bad request): the worker itself is fine."""


class EngineCrashed(EngineError):
    """The worker died during the call. The next call starts a new one."""


class EngineTimeout(EngineCrashed):
    """The worker took longer than the timeout and was stopped. The next call starts a new one."""


@dataclass(frozen=True)
class EngineStatus:
    running: bool
    pid: int | None
    starts: int            # how many workers this client has started (more than 1 means restarts)
    calls: int


class EngineClient:
    def __init__(self, corpus_path: Path | str, *, node: str = "node", max_heap_mb: int = 3584,
                 timeout_s: float = 900.0, argv: list[str] | None = None):
        """`argv` replaces the whole worker command line (tests use it to run a worker that misbehaves)."""
        self.argv = argv or [node, f"--max-old-space-size={max_heap_mb}", str(WORKER),
                             "--corpus", str(Path(corpus_path).resolve())]
        self._base_argv = list(self.argv)           # without --hadiths
        self._fixed_argv = argv is not None
        self._hadiths: Path | None = None
        self.timeout_s = timeout_s
        self._lock = threading.Lock()
        self._proc: subprocess.Popen[str] | None = None
        self._lines: queue.Queue[Any] = queue.Queue()
        self._stderr: deque[str] = deque(maxlen=60)
        self._next_id = 0
        self._starts = 0
        self._calls = 0

    @classmethod
    def from_settings(cls, settings: Settings) -> EngineClient:
        return cls(settings.corpus_path, node=settings.node, max_heap_mb=settings.engine_max_heap_mb,
                   timeout_s=settings.engine_timeout_s)

    # ---- the engine's commands -----------------------------------------------------------------------------

    def info(self) -> dict[str, Any]:
        """The fingerprint (hashes of the engine files and the corpus) and the corpus sizes."""
        return self.call("info")

    def detect(self, words: list[dict[str, Any]],
               options: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Findings for timed words [{word, start, end}]. Options: engine, profile, qiraat, adhkar,
        customQuotes."""
        return self.call("detect", words=words, options=options or {})

    def envelopes(self, findings: list[dict[str, Any]], words: list[dict[str, Any]], version: int,
                  options: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Laya envelopes (version 1, 2 or 3) for findings: [{members, state, questions, ...}]."""
        return self.call("envelopes", findings=findings, words=words, version=version, options=options or {})

    def search(self, text: str, options: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Corpus units matching `text` (a reference such as "البقرة: 255" or words). Options also: kind,
        limit."""
        return self.call("search", text=text, options=options or {})

    @property
    def hadiths_path(self) -> Path | None:
        """The hadith file the worker reads in place of the corpus's own hadiths (None: the corpus's own)."""
        return self._hadiths

    def use_hadiths(self, path: Path | str | None) -> bool:
        """Read the hadiths from another file (a prepared corpus source, see features/corpora) or, with None,
        from the corpus file again. The worker loads the corpus when it starts, so a change restarts it (the
        next call starts the new one). Returns whether anything changed."""
        new = Path(path).resolve() if path else None
        with self._lock:
            if new == self._hadiths:
                return False
            self._hadiths = new
            if not self._fixed_argv:
                self.argv = [*self._base_argv, *(["--hadiths", str(new)] if new else [])]
        self.close()
        return True

    def call(self, cmd: str, **args: Any) -> Any:
        """Send one command to the worker and return its result (see engine/src/worker.ts for the
        commands)."""
        with self._lock:
            if self._proc is None or self._proc.poll() is not None:
                self._start()
            assert self._proc is not None and self._proc.stdin is not None
            self._next_id += 1
            self._calls += 1
            request_id = self._next_id
            try:
                request = json.dumps({"id": request_id, "cmd": cmd, **args}, ensure_ascii=False)
                self._proc.stdin.write(request + "\n")
                self._proc.stdin.flush()
            except (BrokenPipeError, OSError):
                pass                       # it died: the reader sees the end of stdout, reported below
            try:
                line = self._lines.get(timeout=self.timeout_s)
            except queue.Empty:
                self._kill()
                raise EngineTimeout(f"engine worker took more than {self.timeout_s:g} s on {cmd!r}; "
                                    "stopped it"
                                    + self._stderr_tail()) from None
            if line is _EOF:
                self._proc.wait(timeout=5)
                raise EngineCrashed(f"engine worker died during {cmd!r} (exit code {self._proc.returncode})"
                                    + self._stderr_tail())
        answer = json.loads(line)
        if answer.get("id") != request_id:
            raise EngineError(f"engine worker answered request {answer.get('id')}, expected {request_id}")
        if not answer.get("ok"):
            raise EngineError(answer.get("error") or "unknown engine worker error")
        return answer["result"]

    def status(self) -> EngineStatus:
        proc = self._proc
        running = proc is not None and proc.poll() is None
        return EngineStatus(running, proc.pid if running and proc else None, self._starts, self._calls)

    def close(self) -> None:
        """Stop the worker (closing its stdin ends it). A later call would start a new one."""
        with self._lock:
            proc = self._proc
            if proc is None or proc.poll() is not None:
                return
            try:
                assert proc.stdin is not None
                proc.stdin.close()
                proc.wait(timeout=10)
            except (subprocess.TimeoutExpired, OSError):
                self._kill()

    # ---- the process ---------------------------------------------------------------------------------------

    def _start(self) -> None:
        self._starts += 1
        if self._starts > 1:
            log.warning("restarting the engine worker (start %d)", self._starts)
        self._stderr.clear()
        self._proc = subprocess.Popen(self.argv, cwd=REPO_ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
        # Each process gets its own queue, so a line from a dead worker can never answer the next worker's
        # request.
        self._lines = queue.Queue()
        threading.Thread(target=_pump_stdout, args=(self._proc, self._lines), daemon=True,
                         name="engine-stdout").start()
        threading.Thread(target=_pump_stderr, args=(self._proc, self._stderr), daemon=True,
                         name="engine-stderr").start()

    def _kill(self) -> None:
        if self._proc is not None and self._proc.poll() is None:
            self._proc.kill()
            self._proc.wait(timeout=10)

    def _stderr_tail(self) -> str:
        time.sleep(0.05)                   # let the stderr reader catch the last lines a dying worker printed
        tail = "\n".join(list(self._stderr)[-20:]).strip()
        return f":\n{tail}" if tail else ""


def _pump_stdout(proc: subprocess.Popen[str], lines: queue.Queue[Any]) -> None:
    assert proc.stdout is not None
    for line in proc.stdout:
        lines.put(line)
    lines.put(_EOF)


def _pump_stderr(proc: subprocess.Popen[str], tail: deque[str]) -> None:
    assert proc.stderr is not None
    for line in proc.stderr:
        tail.append(line.rstrip("\n"))
