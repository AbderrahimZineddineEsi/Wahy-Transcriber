"""Ground-truth labels for engine detections, with a trust tier per label (see docs/plans/laya-datagen-plan.md §3).

Verdict is decided by the GT, never by a model. Tiers:
  pos_strong   GT quotes the same text here                      -> CORRECT
  wrong_id     GT quotes a different text here                   -> FALSE
  neg_weak     aligned region, GT words support the span, but no quote marker (Quran only) -> FALSE
  asr_mismatch the GT words do NOT contain the canonical text (ASR made it look like a quote) -> FALSE, low trust
  silent       GT has no opinion (unmarked hadith/adhkar, or an undiacritised-looking quote)  -> None
  unalignable  ASR region cannot be tied to the GT                                           -> None
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from rapidfuzz.fuzz import ratio

from .align import Alignment
from .gt_parse import GTDoc

MIN_SPAN_QUALITY = 0.6
IMMEDIATE = 8                 # ai-verifier.js shows 8 words before/after the span
EVIDENCE_SIM = 75.0


@dataclass
class Label:
    tier: str
    verdict: Optional[str] = None              # CORRECT | FALSE | None
    boundary: Optional[str] = None             # COMPLETE_SPAN | MISSING_START | MISSING_END | MISSING_BOTH | None
    flags: List[str] = field(default_factory=list)
    gt_unit: Optional[str] = None


@dataclass
class DocCtx:
    gt: GTDoc
    al: Alignment
    asr_tokens: List[str]
    word_tok: List[int]                        # first asr-token index of each ASR word; len = n_words + 1
    norm_text: Callable[[str], List[str]]
    unit_norms: Callable[[str], Optional[List[str]]]


def _overlap(a0: int, a1: int, b0: int, b1: int) -> int:
    return max(0, min(a1, b1) - max(a0, b0))


def _coverage(tokens: List[str], canon: List[str]) -> float:
    if not tokens:
        return 0.0
    cs = set(canon)
    return sum(1 for t in tokens if t in cs) / len(tokens)


# a verse opening with «قال الله» looks exactly like the speaker's own cue «قال الله تعالى:»: not evidence of a cut
CUE_WORDS = {"قال", "الله", "تعالى", "وتعالى", "سبحانه", "جل", "وعلا", "عز", "وجل", "يقول", "فقال", "وقال"}


def _evidence(missing: List[str], seen: List[str]) -> bool:
    missing = [m for m in missing if m not in CUE_WORDS]
    return any(ratio(m, s) >= EVIDENCE_SIM for m in missing for s in seen)


def label_detection(det: Dict[str, Any], c: DocCtx) -> Label:
    ws, we = det["wordStartIdx"], det["wordEndIdx"]
    a0, a1 = c.word_tok[ws], c.word_tok[we + 1]
    if c.al.quality(a0, a1) < MIN_SPAN_QUALITY:
        return Label("unalignable")
    g = sorted(c.al.asr2gt[t] for t in range(a0, a1) if c.al.asr2gt[t] >= 0)
    g0, g1 = g[0], g[-1] + 1
    gtoks = [c.gt.tokens[i] for i in g]
    canon = c.norm_text(det.get("canonicalText", ""))
    need = max(2, int(0.4 * len(g)))

    best = max(c.gt.quran, key=lambda s: _overlap(g0, g1, s.gt_start, s.gt_end), default=None)
    if best is not None and _overlap(g0, g1, best.gt_start, best.gt_end) >= need:
        quoted = c.gt.tokens[max(g0, best.gt_start):min(g1, best.gt_end)]
        compatible = _coverage(quoted, canon) >= 0.8
        if det["sourceType"] == "QURAN" and compatible:
            flags = [] if best.unit_id == det.get("unitId") else ["ref_differs"]
            lab = Label("pos_strong", "CORRECT", flags=flags, gt_unit=best.unit_id)
            if best.unit_id == det.get("unitId"):
                lab.boundary = _boundary(det, best, c, a0, a1)
            return lab
        if not compatible:
            return Label("wrong_id", "FALSE", gt_unit=best.unit_id)
        return Label("silent", flags=["verse_inside_other_type"], gt_unit=best.unit_id)

    if det["sourceType"] in ("HADITH", "ADHKAR"):
        reg = max(c.gt.hadith, key=lambda r: _overlap(g0, g1, r.gt_start, r.gt_end), default=None)
        if reg is not None and _overlap(g0, g1, reg.gt_start, reg.gt_end) >= need:
            quoted = c.gt.tokens[max(g0, reg.gt_start):min(g1, reg.gt_end)]
            if _coverage(quoted, canon) >= 0.6:
                return Label("pos_strong", "CORRECT", boundary=_region_boundary(det, reg, c, a0, a1, g0, g1))
        return Label("silent")

    # QURAN detection with no GT quote at this place
    tash = sum(1 for i in g if c.gt.tashkeel[i]) / len(g)
    if tash >= 0.5:
        return Label("silent", flags=["diacritised_unreferenced"])     # looks like a quote the page did not tag
    if _coverage(gtoks, canon) < 0.5:
        return Label("asr_mismatch", "FALSE")
    return Label("neg_weak", "FALSE")


def _boundary(det: Dict[str, Any], span, c: DocCtx, a0: int, a1: int) -> Optional[str]:
    """Words of the ayah the speaker said but the detection cut off, confirmed by evidence in the ASR neighbours."""
    segs = det.get("qSegments") or []
    if not segs:
        return None
    qs, qe = segs[0][0], segs[-1][1]
    u = c.unit_norms(span.unit_id)
    if not u:
        return None
    ws, we = det["wordStartIdx"], det["wordEndIdx"]
    before = c.asr_tokens[c.word_tok[max(0, ws - IMMEDIATE)]:c.word_tok[ws]]
    after = c.asr_tokens[c.word_tok[we + 1]:c.word_tok[min(len(c.word_tok) - 1, we + 1 + IMMEDIATE)]]
    miss_start = span.u_start < qs and _evidence(u[max(span.u_start, qs - 10):qs], before)
    miss_end = span.u_end > qe and _evidence(u[qe:min(span.u_end, qe + 10)], after)
    return {(True, True): "MISSING_BOTH", (True, False): "MISSING_START", (False, True): "MISSING_END"}.get(
        (miss_start, miss_end), "COMPLETE_SPAN")


def _region_boundary(det: Dict[str, Any], reg, c: DocCtx, a0: int, a1: int, g0: int, g1: int) -> Optional[str]:
    """Hadith: the written matn continues past the detection, and >=2 of those words (words of this hadith) sit in the
    ASR right next to it -> the engine cut the quote short on that side."""
    unit = set(c.unit_norms(det.get("unitId")) or [])
    if not unit:
        return None
    ws, we = det["wordStartIdx"], det["wordEndIdx"]
    lo = c.word_tok[max(0, ws - IMMEDIATE)]
    hi = c.word_tok[min(len(c.word_tok) - 1, we + 1 + IMMEDIATE)]

    def count(t0: int, t1: int, inside) -> int:
        n = 0
        for t in range(t0, t1):
            gi = c.al.asr2gt[t]
            if gi >= 0 and inside(gi) and c.gt.tokens[gi] in unit and c.gt.tokens[gi] not in CUE_WORDS:
                n += 1
        return n
    miss_start = count(lo, a0, lambda gi: reg.gt_start <= gi < g0) >= 2
    miss_end = count(a1, hi, lambda gi: g1 <= gi < reg.gt_end) >= 2
    return {(True, True): "MISSING_BOTH", (True, False): "MISSING_START", (False, True): "MISSING_END"}.get(
        (miss_start, miss_end), "COMPLETE_SPAN")
