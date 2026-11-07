"""One lesson -> labelled candidate records for each requested engine."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .align import align
from .cache import JsonCache, sha
from .cases import tag_cases
from .engine_bridge import EngineBridge
from .gt_parse import parse_gt
from .label import DocCtx, label_detection
from .sources.binbaz import Lesson

DOC_GATE = 0.5            # aligned share of both ASR and GT inside the anchored region


def build_ctx(lesson: Lesson, words: List[str], bridge: EngineBridge):
    nw = bridge.tokenize_words
    gt = parse_gt([(b.kind, b.text) for b in lesson.blocks], nw, bridge.surah_names(),
                  lambda ids: bridge.unit_norms(ids))
    per_word = nw(words)
    asr_tokens: List[str] = []
    word_tok: List[int] = []
    for toks in per_word:
        word_tok.append(len(asr_tokens))
        asr_tokens += toks
    word_tok.append(len(asr_tokens))
    al = align(asr_tokens, gt.tokens)
    unit_cache: Dict[str, Optional[List[str]]] = {}

    def unit_norms(uid: str) -> Optional[List[str]]:
        if uid not in unit_cache:
            unit_cache[uid] = bridge.unit_norms([uid]).get(uid)
        return unit_cache[uid]

    return DocCtx(gt, al, asr_tokens, word_tok, lambda t: sum(nw(t.split()), []), unit_norms)


def process_lesson(lesson: Lesson, asr_words: List[str], bridge: EngineBridge, engines: List[str],
                   cache: Optional[JsonCache] = None) -> Dict[str, Any]:
    ctx = build_ctx(lesson, asr_words, bridge)
    cov_asr, cov_gt = ctx.al.coverage()
    report = {"doc_id": lesson.id, "asr_tokens": len(ctx.asr_tokens), "gt_tokens": len(ctx.gt.tokens),
              "coverage_asr": round(cov_asr, 3), "coverage_gt": round(cov_gt, 3), "anchors": ctx.al.n_anchors,
              "gt_quran_spans": len(ctx.gt.quran), "gt_hadith_regions": len(ctx.gt.hadith),
              "unresolved_refs": len(ctx.gt.unresolved_refs)}
    report["passed_gate"] = min(cov_asr, cov_gt) >= DOC_GATE
    records: List[Dict[str, Any]] = []
    if not report["passed_gate"]:
        return {"report": report, "records": records}
    for engine in engines:
        dets = bridge.detect(engine, asr_words)
        for i, d in enumerate(dets):
            lab = label_detection(d, ctx)
            records.append({
                "id": f"{lesson.id}:{engine}:{d['wordStartIdx']}-{d['wordEndIdx']}:{d.get('unitId')}",
                "doc_id": lesson.id, "engine": engine, "det": {k: v for k, v in d.items() if k != "envelope"},
                "envelope": d["envelope"],
                "label": {"tier": lab.tier, "verdict": lab.verdict, "boundary": lab.boundary,
                          "flags": lab.flags, "gt_unit": lab.gt_unit},
                "cases": tag_cases(d, lab, ctx),
            })
    report["by_tier"] = {}
    gt_units = bridge.unit_words(sorted({q.unit_id for q in ctx.gt.quran}))
    out_doc = {
        "doc_id": lesson.id, "title": lesson.title, "url": lesson.url,
        "gt": {"words": ctx.gt.words, "tok_word": ctx.gt.tok_word,
               "quran": [vars(q) for q in ctx.gt.quran], "hadith": [vars(h) for h in ctx.gt.hadith],
               "units": gt_units},
        "word_tok": ctx.word_tok, "asr2gt": ctx.al.asr2gt, "exact": ctx.al.exact,
    }
    for r in records:
        report["by_tier"][r["label"]["tier"]] = report["by_tier"].get(r["label"]["tier"], 0) + 1
    return {"report": report, "records": records, "doc": out_doc}


LABEL_VERSION = "6"       # bump when gt_parse / align / label / cases change, to invalidate cached records


def process_no_gt(doc_id: str, title: str, url: str, asr: Dict[str, Any], bridge: EngineBridge,
                  engines: List[str]) -> Dict[str, Any]:
    """A lecture with no written transcript (YouTube): engine findings only, label tier "no_gt" (to be labelled by a
    model or a person). Same bundle shape as process_cached, without the GT parts; cached the same way."""
    cache = JsonCache("records")
    key = sha("no_gt", doc_id, asr["audio_sha"], bridge.fingerprint(), sorted(engines))
    hit = cache.get(key)
    if hit is None:
        words = [w["word"] for w in asr["words"]]
        records = []
        for engine in engines:
            for d in bridge.detect(engine, words):
                records.append({
                    "id": f"{doc_id}:{engine}:{d['wordStartIdx']}-{d['wordEndIdx']}:{d.get('unitId')}",
                    "doc_id": doc_id, "engine": engine, "det": {k: v for k, v in d.items() if k != "envelope"},
                    "envelope": d["envelope"],
                    "label": {"tier": "no_gt", "verdict": None, "boundary": None, "flags": [], "gt_unit": None},
                    "cases": [],
                })
        hit = {"report": {"doc_id": doc_id, "asr_words": len(words), "findings": len(records), "passed_gate": True},
               "records": records, "doc": {"doc_id": doc_id, "title": title, "url": url}, "asr_words": asr["words"]}
        cache.put(key, hit)
    return hit


def process_cached(lesson: Lesson, asr: Dict[str, Any], bridge: EngineBridge, engines: List[str]) -> Dict[str, Any]:
    """process_lesson, cached on (lesson text, ASR audio hash, engine/corpus fingerprint, engines, label logic version).

    Editing an engine file changes the fingerprint, so that lesson is re-detected; the ASR is never redone."""
    cache = JsonCache("records")
    key = sha(lesson.id, [b.text for b in lesson.blocks], asr["audio_sha"], bridge.fingerprint(), sorted(engines), LABEL_VERSION)
    hit = cache.get(key)
    if hit is None:
        hit = process_lesson(lesson, [w["word"] for w in asr["words"]], bridge, engines)
        hit["asr_words"] = asr["words"]                 # with timestamps, for audio clips on review cards
        cache.put(key, hit)
    return hit
