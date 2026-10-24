"""Python client for js/harness.js: runs the app's real v3/v4 engines and builds Laya envelopes."""
from __future__ import annotations

import hashlib
import json
import subprocess
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = Path(__file__).resolve().parent / "js" / "harness.js"


class EngineBridgeError(RuntimeError):
    pass


class EngineBridge:
    def __init__(self, hadith_path: Optional[str] = None, node: str = "node", timeout: float = 600.0,
                 extra_engine_files: Optional[List[str]] = None):
        self.hadith_path = hadith_path
        self.node = node
        self.timeout = timeout
        self.extra_engine_files = extra_engine_files or []
        self._proc: Optional[subprocess.Popen] = None
        self._next = 0
        self._lock = threading.Lock()
        self.info: Dict[str, Any] = {}

    def start(self) -> Dict[str, Any]:
        self._proc = subprocess.Popen(
            [self.node, "--max-old-space-size=4096", str(HARNESS), str(REPO_ROOT)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8",
        )
        self.info = self._call("init", hadith_path=self.hadith_path, extra_engine_files=self.extra_engine_files)
        return self.info

    def _call(self, cmd: str, **kw: Any) -> Any:
        if self._proc is None or self._proc.poll() is not None:
            raise EngineBridgeError("node harness is not running")
        with self._lock:
            self._next += 1
            req = {"id": self._next, "cmd": cmd, **kw}
            self._proc.stdin.write(json.dumps(req, ensure_ascii=False) + "\n")
            self._proc.stdin.flush()
            line = self._proc.stdout.readline()
        if not line:
            raise EngineBridgeError("node harness died")
        res = json.loads(line)
        if not res.get("ok"):
            raise EngineBridgeError(res.get("error", "unknown harness error"))
        return res["result"]

    def tokenize(self, text: str) -> List[str]:
        return self._call("tokenize", text=text)

    def tokenize_words(self, words: List[str]) -> List[List[str]]:
        return self._call("tokenize_words", words=words)

    def surah_names(self) -> Dict[str, str]:
        return self._call("surah_names")

    def unit_norms(self, ids: List[str], engine: str = "v4") -> Dict[str, List[str]]:
        return self._call("unit_norms", ids=ids, engine=engine)

    def unit_words(self, ids: List[str], engine: str = "v4") -> Dict[str, Dict[str, Any]]:
        return self._call("unit_words", ids=ids, engine=engine)

    def detect(self, engine: str, words: List[str]) -> List[Dict[str, Any]]:
        """Run `engine` on ASR words; each detection carries the app's own canonical envelope."""
        return self._call("detect", engine=engine, words=words)

    def fingerprint(self, engine: str = "") -> str:
        fp = self._call("fingerprint")
        return hashlib.sha256(json.dumps(fp, sort_keys=True).encode()).hexdigest()[:16]

    def close(self) -> None:
        if self._proc and self._proc.poll() is None:
            self._proc.stdin.close()
            self._proc.terminate()

    def __enter__(self) -> "EngineBridge":
        self.start()
        return self

    def __exit__(self, *a: Any) -> None:
        self.close()
