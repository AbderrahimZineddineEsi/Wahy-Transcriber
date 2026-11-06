"""The text Tafrigh reads, built from a lecture's current words and its findings (port of the browser's
`tafrighSource` in js/events.js). How quotes are sent depends on the text source:

    raw_findings   every quote (found by the engine or added by hand) placed by its word range, so the segmenter
                   makes each ayah / hadith / dhikr its own sentence (default)
    corrected      the same, but each quote's spoken words are replaced by its text from the source
    raw            the plain text, quotes not marked at all

    src = build_source(words, findings, "corrected")
    src["raw_text"], src["asr_words"], src["detection_spans"]      # what segment_transcript() takes
"""

from __future__ import annotations

from typing import Any

TEXT_SOURCES = ("raw_findings", "corrected", "raw")


def _kind(source_type: str | None) -> str:
    t = (source_type or "").upper()
    return "quran" if t == "QURAN" else "hadith" if t == "HADITH" else "adhkar"


def span_meta(d: dict[str, Any]) -> dict[str, Any]:
    canonical = d.get("canonicalText") or (
        " ".join(d["canonicalSegments"]) if isinstance(d.get("canonicalSegments"), list) else ""
    )
    return {
        "type": _kind(d.get("sourceType")),
        "unit_id": d.get("unitId"),
        "ref": d.get("displayRef") or d.get("reference") or "",
        "band": d.get("confidenceBand") or "",
        "canonical": canonical,
    }


def quote_findings(words: list[dict[str, Any]], findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The findings that are quotes for Tafrigh: not rejected by a verifier (verdict FALSE), inside the
    words, ordered, and the first of any overlapping ones."""
    last_end = -1
    out: list[dict[str, Any]] = []
    usable = [
        d for d in findings
        if d.get("verdict") != "FALSE"
        and 0 <= int(d["wordStartIdx"]) < len(words)
        and 0 <= int(d["wordEndIdx"]) < len(words)
        and int(d["wordEndIdx"]) >= int(d["wordStartIdx"])
    ]
    for d in sorted(usable, key=lambda d: int(d["wordStartIdx"])):
        if int(d["wordStartIdx"]) <= last_end:
            continue
        last_end = int(d["wordEndIdx"])
        out.append(d)
    return out


def _asr_words(texts_times: list[tuple[str, float, float]]) -> tuple[list[dict[str, Any]], str]:
    cursor, asr = 0, []
    for word, start, end in texts_times:
        asr.append({"start": start, "end": end, "char_start": cursor, "char_end": cursor + len(word)})
        cursor += len(word) + 1
    return asr, " ".join(w for w, _, _ in texts_times)


def build_source(words: list[dict[str, Any]], findings: list[dict[str, Any]], mode: str = "raw_findings"
                 ) -> dict[str, Any]:
    """`words` = [{word, start, end}], `findings` = the engine's finding objects (with an optional `verdict`)."""
    if mode not in TEXT_SOURCES:
        raise ValueError(f"unknown text source {mode!r}; use one of {', '.join(TEXT_SOURCES)}")
    plain, raw_text = _asr_words([(w["word"], w["start"], w["end"]) for w in words])
    if mode == "raw":
        return {"raw_text": raw_text, "asr_words": plain, "detection_spans": [],
                "use_detection_boundaries": False, "text_source": mode}
    dets = quote_findings(words, findings)
    if mode == "corrected":
        return _corrected(words, dets)
    spans = [
        {"start": plain[int(d["wordStartIdx"])]["char_start"], "end": plain[int(d["wordEndIdx"])]["char_end"],
         **span_meta(d)}
        for d in dets
    ]
    return {"raw_text": raw_text, "asr_words": plain, "detection_spans": [s for s in spans if s["end"] > s["start"]],
            "use_detection_boundaries": True, "text_source": mode}


def _corrected(words: list[dict[str, Any]], dets: list[dict[str, Any]]) -> dict[str, Any]:
    """Every quote written from its source: each quote segment's spoken words are replaced by its reference words
    (commentary gaps between segments stay as spoken). The new words get times spread evenly over the spoken
    quote's time, so pause-based sentence cuts still work around it."""
    out: list[tuple[str, float, float]] = []
    spans: list[tuple[int, int, dict[str, Any]]] = []

    def push(word: str, start: float, end: float) -> None:
        if word:
            out.append((word, start, end))

    def push_spoken(k: int) -> None:
        push(words[k]["word"], words[k]["start"], words[k]["end"])

    i = 0
    for d in dets:
        ws, we = int(d["wordStartIdx"]), int(d["wordEndIdx"])
        while i < ws:
            push_spoken(i)
            i += 1
        raw_segs = d.get("segments") if isinstance(d.get("segments"), list) and d["segments"] else [[ws, we + 1]]
        segs = [(max(ws, int(a)), min(we + 1, int(b))) for a, b in raw_segs]
        segs = [(a, b) for a, b in segs if b > a]
        canon_segs = d.get("canonicalSegments")
        if isinstance(canon_segs, list) and len(canon_segs) == len(segs):
            parts = [(sg, canon_segs[k]) for k, sg in enumerate(segs)]
        else:
            parts = [((ws, we + 1), d.get("canonicalText"))]
        cur = ws
        for (a, b), canon in parts:
            while cur < a:                     # commentary gap, as spoken
                push_spoken(cur)
                cur += 1
            spoken = words[a:b]
            if not spoken:
                continue
            toks = [t for t in str(canon or "").split() if t] or [w["word"] for w in spoken]
            t0, t1 = float(spoken[0]["start"]), float(spoken[-1]["end"])
            step = (t1 - t0) / len(toks)
            first = len(out)
            for k, tok in enumerate(toks):
                push(tok, t0 + k * step, t0 + (k + 1) * step)
            spans.append((first, len(out) - 1, {**span_meta(d), "canonical": " ".join(toks)}))
            cur = b
        while cur <= we:
            push_spoken(cur)
            cur += 1
        i = we + 1
    while i < len(words):
        push_spoken(i)
        i += 1

    asr, raw_text = _asr_words(out)
    detection_spans = [
        {"start": asr[first]["char_start"], "end": asr[last]["char_end"], **meta}
        for first, last, meta in spans if last >= first
    ]
    return {"raw_text": raw_text, "asr_words": asr, "detection_spans": detection_spans,
            "use_detection_boundaries": True, "text_source": "corrected"}
