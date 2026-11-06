"""Python client for the engine worker (engine/src/worker.ts): runs the engines v3 / v4 / v5 and builds Laya envelopes.

Since rewrite phase 5 the datagen uses the new engine package, the same code the new app runs (ADR 0002, ADR 0003).
It used to load the old browser files (js/*.js) in a Node vm (js/harness.js); this class keeps that interface, so its
callers did not change. The one thing it no longer does is load another engine file (`extra_engine_files` beyond
the standard ones, "<engine>@<tag>" engine names): copy the engine inside engine/src/ instead.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKER = REPO_ROOT / "engine" / "src" / "worker.ts"
CORPUS = REPO_ROOT / "data" / "corpus.json"
# the old harness loaded these files itself; the engine package has them all, so asking for them changes nothing
STANDARD_ENGINE_FILES = {"js/engine.js", "js/engine_v4.js", "js/engine_v5.js"}
# the finding fields the datagen keeps (records, cards, rows): the old harness's list, same order
DET_FIELDS = ["id", "unitId", "sourceType", "displayRef", "confidenceBand", "totalScore", "hasCitationCue",
              "isAmbiguous", "wordStartIdx", "wordEndIdx", "charStart", "charEnd", "matchedText", "canonicalText",
              "segments", "qSegments", "qiraah", "candidateRefs", "embeddedQuran", "alsoAdhkar", "snappedToCanonical"]


class EngineBridgeError(RuntimeError):
    pass


def engine_options(engine: str, opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """The datagen's engine names as the worker's options: "v4", "v5:loose" (a profile), "v5/<tag>" with `opts`
    (v5 rebuilt with params.v5 = opts, to measure one fix)."""
    if "@" in engine:
        raise EngineBridgeError(f"engine {engine}: loading another engine file is not supported any more "
                                "(copy the engine inside engine/src/ instead)")
    base = re.split(r"[/:]", engine)[0]
    m = re.search(r":([a-z]+)", engine)
    out: Dict[str, Any] = {"engine": base, "profile": m.group(1) if m else "normal"}
    if "/" in engine:
        out["v5"] = opts or {}
    return out


class EngineBridge:
    def __init__(self, hadith_path: Optional[str] = None, node: str = "node",
                 extra_engine_files: Optional[List[str]] = None):
        unknown = sorted(set(extra_engine_files or []) - STANDARD_ENGINE_FILES)
        if unknown:
            raise EngineBridgeError(f"engine files {unknown}: loading another engine file is not supported any more "
                                    "(copy the engine inside engine/src/ instead)")
        self.hadith_path = hadith_path
        self.node = node
        self._proc: Optional[subprocess.Popen] = None
        self._stderr = None
        self._next = 0
        self._lock = threading.Lock()
        self.info: Dict[str, Any] = {}

    def start(self) -> Dict[str, Any]:
        cmd = [self.node, "--max-old-space-size=4096", str(WORKER), "--corpus", str(CORPUS)]
        if self.hadith_path:
            cmd += ["--hadiths", str(self.hadith_path)]
        self._stderr = tempfile.TemporaryFile()
        self._proc = subprocess.Popen(cmd, cwd=REPO_ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=self._stderr, text=True, encoding="utf-8")
        self.info = self._call("info")
        return self.info

    def _call(self, cmd: str, **kw: Any) -> Any:
        if self._proc is None or self._proc.poll() is not None:
            raise EngineBridgeError("engine worker is not running" + self._stderr_tail())
        with self._lock:
            self._next += 1
            req = {"id": self._next, "cmd": cmd, **kw}
            try:
                self._proc.stdin.write(json.dumps(req, ensure_ascii=False) + "\n")
                self._proc.stdin.flush()
            except BrokenPipeError:
                pass                     # it died: readline() below returns "" and the error says why
            line = self._proc.stdout.readline()
        if not line:
            raise EngineBridgeError("engine worker died" + self._stderr_tail())
        res = json.loads(line)
        if res.get("id") != req["id"]:
            raise EngineBridgeError(f"engine worker answered request {res.get('id')}, expected {req['id']}")
        if not res.get("ok"):
            raise EngineBridgeError(res.get("error", "unknown engine worker error"))
        return res["result"]

    def _stderr_tail(self) -> str:
        if self._stderr is None:
            return ""
        self._stderr.seek(0)
        tail = self._stderr.read().decode("utf-8", "replace").strip()[-2000:]
        return f":\n{tail}" if tail else ""

    def tokenize(self, text: str) -> List[str]:
        return self._call("tokenize", text=text)

    def tokenize_words(self, words: List[str]) -> List[List[str]]:
        return self._call("tokenize_words", words=words)

    def surah_names(self) -> Dict[str, str]:
        return self._call("surah_names")

    def _units(self, ids: List[str], engine: str) -> Dict[str, Dict[str, Any]]:
        return self._call("units", ids=ids, options=engine_options(engine))

    def unit_norms(self, ids: List[str], engine: str = "v4") -> Dict[str, List[str]]:
        return {i: u["norms"] for i, u in self._units(ids, engine).items() if u["norms"] is not None}

    def unit_words(self, ids: List[str], engine: str = "v4") -> Dict[str, Dict[str, Any]]:
        return {i: {"words": u["words"], "ref": u["ref"]} for i, u in self._units(ids, engine).items()}

    def detect(self, engine: str, words: List[str], opts: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Run `engine` on ASR words; each detection carries its canonical (v1) envelope and its unit's words.
        `engine` = "v5/<tag>" with `opts` runs v5 rebuilt with params.v5 = opts (e.g. one fix switched off)."""
        options = engine_options(engine, opts)
        timed = [{"word": w, "start": 0, "end": 0} for w in words]
        found = self._call("detect", words=timed, options=options)
        envs = self._call("envelopes", findings=found, words=timed, version=1, options=options)
        units = self._call("units", ids=sorted({d["unitId"] for d in found if d.get("unitId")}), options=options)
        out = []
        for d, env in zip(found, envs):
            rec = {k: d[k] for k in DET_FIELDS if k in d}
            rec["envelope"] = {"state": env["state"], "questions": env["questions"]}
            unit_words = (units.get(d.get("unitId")) or {}).get("words")
            rec["unit_len"] = len(unit_words) if unit_words is not None else None
            rec["unit_words"] = unit_words         # full original text, for review cards
            out.append(rec)
        return out

    def laya_v2(self, engine: str, words: List[str], dets: List[Dict[str, Any]], options: Dict[str, Any],
                targets: Optional[List[int]] = None) -> List[Dict[str, Any]]:
        """Laya v2 requests (engine/src/envelopes.ts, version 2) for one engine run:
        [{members: [index in dets], state, questions}], one per passage / finding that holds a target."""
        timed = [{"word": w, "start": 0, "end": 0} for w in words]
        opts = {**engine_options(engine), "passages": options.get("passages"), "neighbours": options.get("neighbours"),
                "targets": targets}
        return self._call("envelopes", findings=dets, words=timed, version=2, options=opts)

    def fingerprint(self, engine: str = "") -> str:
        """Changes whenever an engine file or the corpus changes: the datagen's caches are keyed on it."""
        fp = self._call("info")["fingerprint"]
        return hashlib.sha256(json.dumps(fp, sort_keys=True).encode()).hexdigest()[:16]

    def close(self) -> None:
        if self._proc and self._proc.poll() is None:
            self._proc.stdin.close()
            try:
                self._proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self._proc.terminate()
        if self._stderr is not None:
            self._stderr.close()
            self._stderr = None

    def __enter__(self) -> "EngineBridge":
        self.start()
        return self

    def __exit__(self, *a: Any) -> None:
        self.close()
