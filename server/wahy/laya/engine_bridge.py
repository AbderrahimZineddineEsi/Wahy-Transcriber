"""The datagen's view of the engine: runs the engines v3 / v4 / v5 and builds Laya envelopes, through the app's own
engine client (wahy/core/engine.py, ADR 0002), so the datasets and the app use one engine and one envelope builder
(ADR 0003).

The interface is the one the datagen had since rewrite phase 5 (it was a Python client of engine/src/worker.ts of
its own); since phase 22 it is a thin layer over `EngineClient`, which owns the worker process, its restarts and
its timeout. What it adds is the datagen's own vocabulary: engine names such as "v5:loose" or "v5/<tag>", the
finding fields a record keeps, and the cache fingerprint.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from wahy.core.engine import EngineClient, EngineError
from wahy.core.settings import REPO_ROOT

CORPUS = REPO_ROOT / "data" / "corpus.json"
# the old harness loaded these files itself; the engine package has them all, so asking for them changes nothing
STANDARD_ENGINE_FILES = {"js/engine.js", "js/engine_v4.js", "js/engine_v5.js"}
# the finding fields the datagen keeps (records, cards, rows): the old harness's list, same order
DET_FIELDS = ["id", "unitId", "sourceType", "displayRef", "confidenceBand", "totalScore", "hasCitationCue",
              "isAmbiguous", "wordStartIdx", "wordEndIdx", "charStart", "charEnd", "matchedText", "canonicalText",
              "segments", "qSegments", "qiraah", "candidateRefs", "embeddedQuran", "alsoAdhkar", "snappedToCanonical"]
# the datasets were built with a 4 GB worker heap (the app's default is 3.5 GB)
MAX_HEAP_MB = 4096


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


def timed(words: List[str]) -> List[Dict[str, Any]]:
    """Plain words as the worker's timed words. The datasets were built without times, so times stay 0."""
    return [{"word": w, "start": 0, "end": 0} for w in words]


class EngineBridge:
    def __init__(self, hadith_path: Optional[str] = None, node: str = "node",
                 extra_engine_files: Optional[List[str]] = None, client: Optional[EngineClient] = None):
        unknown = sorted(set(extra_engine_files or []) - STANDARD_ENGINE_FILES)
        if unknown:
            raise EngineBridgeError(f"engine files {unknown}: loading another engine file is not supported any more "
                                    "(copy the engine inside engine/src/ instead)")
        self.hadith_path = hadith_path
        self.client = client or EngineClient(CORPUS, node=node, max_heap_mb=MAX_HEAP_MB)
        if hadith_path:
            self.client.use_hadiths(Path(hadith_path))
        self.info: Dict[str, Any] = {}

    def start(self) -> Dict[str, Any]:
        self.info = self._call("info")
        return self.info

    def _call(self, cmd: str, **kw: Any) -> Any:
        try:
            return self.client.call(cmd, **kw)
        except EngineError as e:
            raise EngineBridgeError(str(e)) from e

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
        tw = timed(words)
        found = self._call("detect", words=tw, options=options)
        envs = self._call("envelopes", findings=found, words=tw, version=1, options=options)
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

    def envelopes(self, version: int, engine: str, words: List[str], dets: List[Dict[str, Any]],
                  options: Dict[str, Any], targets: Optional[List[int]] = None) -> List[Dict[str, Any]]:
        """Laya requests of envelope `version` (engine/src/envelopes.ts) for one engine run:
        [{members: [index in dets], state, questions, ...}], one per passage / finding that holds a target.
        `options`: passages, neighbours (v2 only)."""
        opts = {**engine_options(engine), "passages": options.get("passages"), "targets": targets}
        if version == 2:
            opts["neighbours"] = options.get("neighbours")
        return self._call("envelopes", findings=dets, words=timed(words), version=version, options=opts)

    def laya_v2(self, engine: str, words: List[str], dets: List[Dict[str, Any]], options: Dict[str, Any],
                targets: Optional[List[int]] = None) -> List[Dict[str, Any]]:
        """Laya v2 requests (engine/src/envelopes.ts, version 2) for one engine run:
        [{members: [index in dets], state, questions}], one per passage / finding that holds a target."""
        opts = {**engine_options(engine), "passages": options.get("passages"), "neighbours": options.get("neighbours"),
                "targets": targets}
        return self._call("envelopes", findings=dets, words=timed(words), version=2, options=opts)

    def fingerprint(self, engine: str = "") -> str:
        """Changes whenever an engine file or the corpus changes: the datagen's caches are keyed on it."""
        fp = self._call("info")["fingerprint"]
        return hashlib.sha256(json.dumps(fp, sort_keys=True).encode()).hexdigest()[:16]

    def close(self) -> None:
        self.client.close()

    def __enter__(self) -> "EngineBridge":
        self.start()
        return self

    def __exit__(self, *a: Any) -> None:
        self.close()
