"""Review stages built on top of processed lessons (pipeline.process_cached output = a "bundle" per lesson).

  Stage 1  GT check        are the automatically extracted ground-truth quotes right?
  Stage 2  GT findings     engine findings that hit a GT quote: auto-labelled, you confirm or correct
  Stage 3  missed GT       GT quotes the engine did not find: why?
  Stage 4  other findings  engine findings with no GT quote: you label them (engine precision + Laya negatives)
  Stage 5  model check     JEV / Gemini / base Laya vs your labels from stages 2 and 4

Label keys never contain the engine name for findings, so a finding labelled once counts for every engine that
produces the same span on the same unit.
"""
from __future__ import annotations

import math
import random
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------------------------- answer vocabulary
# PARAPHRASE = the sheikh tells the hadith / ayah by its meaning (رواية بالمعنى), mixing its words with his own:
# a useful finding (show his speech AND the original text), but not a verbatim quote, and no boundary to judge.
# IN_HADITH = a verbatim ayah quoted inside a hadith (e.g. the Prophet ﷺ answering each part of the ayah as it is revealed):
# a real quote of the ayah (boundary judged against the ayah), tagged so the hadith context is not lost.
VERDICT = {"CORRECT": "✔ Real quote", "IN_HADITH": "📖 Ayah inside a hadith", "PARAPHRASE": "≈ Quoted by meaning",
           "FALSE": "✘ Not a quote", "NOT_SURE": "? Unsure"}
USEFUL = ("CORRECT", "IN_HADITH", "PARAPHRASE")     # verdicts that make the finding a hit for the engine
WITH_BOUNDARY = ("CORRECT", "IN_HADITH")            # verdicts that get a boundary answer
BOUNDARY = {"COMPLETE_SPAN": "Complete", "MISSING_START": "Missing start", "MISSING_END": "Missing end",
            "MISSING_BOTH": "Missing both"}
GT_CHECK = {"ok": "✔ Correct", "bad_span": "✘ Wrong span", "bad_ref": "✘ Wrong verse / hadith",
            "not_quote": "✘ Not a quote", "unsure": "? Unsure"}
MISS_REASON = {"engine": "Engine should catch it", "asr": "ASR too garbled", "bad_gt": "Bad GT",
               "short": "Too short to matter", "unsure": "? Unsure"}
NOT_ENGINE_FAULT = ("asr", "bad_gt", "short")

SECTIONS_HELP = {
    "asr": "What was said — speech-to-text (what the engine and Laya see)",
    "gt": "Bin Baz written text at this spot (the ground truth)",
    "corpus": "Original text from the corpus — matched part highlighted",
}


# ---------------------------------------------------------------------------------------------- per-lesson helpers
def asr_tok_word(b: Dict[str, Any]) -> List[int]:
    wt = b["doc"]["word_tok"]
    out = []
    for w in range(len(wt) - 1):
        out += [w] * (wt[w + 1] - wt[w])
    return out


def finding_key(r: Dict[str, Any]) -> str:
    d = r["det"]
    return f"{r['doc_id']}|{d['wordStartIdx']}-{d['wordEndIdx']}|{d.get('unitId')}"


def gt_items(b: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Every GT quote of a lesson, projected onto the ASR words (None when it cannot be aligned)."""
    doc = b["doc"]
    a2g, tw = doc["asr2gt"], asr_tok_word(b)
    gt = doc["gt"]
    items = []
    raw = [("QURAN", q) for q in gt["quran"]] + [("HADITH", h) for h in gt["hadith"]]
    for kind, q in raw:
        n = q["gt_end"] - q["gt_start"]
        toks = [t for t, g in enumerate(a2g) if q["gt_start"] <= g < q["gt_end"]]
        alignable = len(toks) >= max(2, math.ceil(0.4 * n))
        unit = gt["units"].get(q.get("unit_id"), {}) if kind == "QURAN" else {}
        items.append({
            "key": f"{doc['doc_id']}|{kind[0]}|{q.get('unit_id', '')}|{q['gt_start']}",
            "doc_id": doc["doc_id"], "kind": kind, "unit_id": q.get("unit_id"), "ref": unit.get("ref"),
            "unit_words": unit.get("words"), "u_start": q.get("u_start"), "u_end": q.get("u_end"),
            "gt_start": q["gt_start"], "gt_end": q["gt_end"], "n_tokens": n, "aligned_tokens": len(toks),
            "alignable": alignable,
            "asr_ws": tw[toks[0]] if toks else None, "asr_we": tw[toks[-1]] if toks else None,
        })
    return items


def _overlap_words(a0: int, a1: int, b0: int, b1: int) -> int:
    return max(0, min(a1, b1) - max(a0, b0) + 1)


def hits(item: Dict[str, Any], r: Dict[str, Any]) -> bool:
    if item["asr_ws"] is None:
        return False
    d = r["det"]
    ov = _overlap_words(item["asr_ws"], item["asr_we"], d["wordStartIdx"], d["wordEndIdx"])
    shorter = min(item["asr_we"] - item["asr_ws"], d["wordEndIdx"] - d["wordStartIdx"]) + 1
    return ov >= max(1, math.ceil(0.3 * shorter))


GT_TIERS = ("pos_strong", "wrong_id")


def is_gt_finding(r: Dict[str, Any]) -> bool:
    return r["label"]["tier"] in GT_TIERS or "verse_inside_other_type" in r["label"]["flags"]


# ---------------------------------------------------------------------------------------------- building the stages
def build(bundles: Dict[str, Dict[str, Any]], engine: str, all_engines: List[str], seed: int = 7) -> Dict[str, Any]:
    """Items for every stage + the automatic recall numbers, for one engine."""
    rnd = random.Random(seed)
    gts, s2, s3, s4 = [], [], [], []
    for doc_id, b in bundles.items():
        if "doc" not in b:
            continue
        items = gt_items(b)
        gts += items
        recs = {e: [r for r in b["records"] if r["engine"] == e] for e in all_engines}
        mine = recs.get(engine, [])
        for r in mine:
            r["_bundle"] = doc_id
            (s2 if is_gt_finding(r) else s4).append(r)
        for it in items:
            it["_bundle"] = doc_id
            if not it["alignable"]:
                continue
            it["caught_by"] = [e for e in all_engines if any(hits(it, r) for r in recs.get(e, []))]
            if engine not in it["caught_by"]:
                s3.append(it)
    for lst in (gts, s2, s3, s4):
        rnd.shuffle(lst)              # any prefix you review is a random sample
    return {"gt": gts, "stage2": s2, "stage3": s3, "stage4": s4}


def recall_table(bundles: Dict[str, Dict[str, Any]], engines: List[str]) -> List[Dict[str, Any]]:
    rows = []
    for e in engines:
        st = build(bundles, e, engines)
        for kind in ("QURAN", "HADITH", "ALL"):
            its = [i for i in st["gt"] if kind == "ALL" or i["kind"] == kind]
            al = [i for i in its if i["alignable"]]
            caught = [i for i in al if e in i.get("caught_by", [])]
            rows.append({"engine": e, "type": kind, "GT quotes": len(its), "alignable": len(al),
                         "caught": len(caught), "recall": round(len(caught) / max(1, len(al)), 3)})
    return rows


# ---------------------------------------------------------------------------------------------- summaries
def pct(a: int, n: int) -> str:
    return f"{a}/{n} ({100 * a / n:.1f}%)" if n else "—"


def summary_gt(items: List[Dict[str, Any]], ans: Dict[str, Any]) -> Dict[str, Any]:
    done = [ans[i["key"]]["answer"] for i in items if i["key"] in ans]
    c = Counter(done)
    judged = len(done) - c["unsure"]
    return {"reviewed": len(done), "of": len(items), "correct": pct(c["ok"], judged),
            **{GT_CHECK[k]: v for k, v in c.items() if k != "ok"}}


def auto_answer(r: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    lab = r["label"]
    if "verse_inside_other_type" in lab["flags"]:
        return None, None
    return lab["verdict"], (lab["boundary"] if lab["verdict"] == "CORRECT" else None)


def summary_stage2(items: List[Dict[str, Any]], ans: Dict[str, Any]) -> Dict[str, Any]:
    v_ok = v_n = b_ok = b_n = 0
    diffs: Counter = Counter()
    for r in items:
        a = ans.get(finding_key(r))
        if not a:
            continue
        av, ab = auto_answer(r)
        hv, hb = a["answer"]["verdict"], a["answer"].get("boundary")
        if hv == "NOT_SURE" or av is None:
            continue
        v_n += 1
        v_ok += av == hv
        if av != hv:
            diffs[f"verdict {VERDICT[av]} → {VERDICT[hv]}"] += 1
        if av == hv == "CORRECT" and ab and hb:
            b_n += 1
            b_ok += ab == hb
            if ab != hb:
                diffs[f"boundary {BOUNDARY[ab]} → {BOUNDARY[hb]}"] += 1
    reviewed = sum(1 for r in items if finding_key(r) in ans)
    return {"reviewed": reviewed, "of": len(items), "auto verdict agrees": pct(v_ok, v_n),
            "auto boundary agrees": pct(b_ok, b_n), **dict(diffs.most_common(6))}


def summary_missed(items: List[Dict[str, Any]], ans: Dict[str, Any], engine: str) -> Dict[str, Any]:
    done = [ans[f"{i['key']}|{engine}"]["answer"] for i in items if f"{i['key']}|{engine}" in ans]
    c = Counter(done)
    out = {"reviewed": len(done), "of": len(items)}
    out.update({MISS_REASON[k]: pct(v, len(done)) for k, v in c.most_common()})
    return out


def summary_stage4(items: List[Dict[str, Any]], ans: Dict[str, Any]) -> Dict[str, Any]:
    done = [ans[finding_key(r)]["answer"] for r in items if finding_key(r) in ans]
    c = Counter(a["verdict"] for a in done)
    judged = c["CORRECT"] + c["IN_HADITH"] + c["PARAPHRASE"] + c["FALSE"]
    b = Counter(a.get("boundary") for a in done if a["verdict"] in WITH_BOUNDARY)
    return {"reviewed": len(done), "of": len(items), "real quotes": pct(c["CORRECT"], judged),
            "ayah inside a hadith": pct(c["IN_HADITH"], judged), "quoted by meaning": pct(c["PARAPHRASE"], judged),
            "not quotes": pct(c["FALSE"], judged), "unsure": c["NOT_SURE"],
            "wrong / incomplete reference": sum(1 for a in done if a.get("ref_issue")),
            "sheikh's words inside": sum(1 for a in done if a.get("has_insertion")),
            **{f"boundary: {BOUNDARY[k]}": v for k, v in b.items() if k}}


def engine_report(st: Dict[str, Any], engine: str, findings_ans: Dict[str, Any], missed_ans: Dict[str, Any]) -> Dict[str, Any]:
    """Recall from GT (raw, and excluding misses you marked as not the engine's fault) + precision estimate."""
    al = [i for i in st["gt"] if i["alignable"]]
    caught = sum(1 for i in al if engine in i.get("caught_by", []))
    missed = st["stage3"]
    m_done = [missed_ans[f"{i['key']}|{engine}"]["answer"] for i in missed if f"{i['key']}|{engine}" in missed_ans]
    m_judged = [a for a in m_done if a != "unsure"]
    not_fault = sum(1 for a in m_judged if a in NOT_ENGINE_FAULT) / len(m_judged) if m_judged else None
    rep: Dict[str, Any] = {"engine": engine, "GT quotes (alignable)": len(al), "caught": caught,
                           "recall": round(caught / max(1, len(al)), 3),
                           "misses reviewed": f"{len(m_done)}/{len(missed)}"}
    if not_fault is not None:
        real_miss = len(missed) * (1 - not_fault)
        rep["misses not engine's fault"] = f"{100 * not_fault:.0f}%"
        rep["recall excl. not-its-fault"] = round(caught / max(1, caught + real_miss), 3)

    # precision: stage 2 uses your label where you gave one, else the automatic one; stage 4 is extrapolated
    s2_true = s2_n = 0
    for r in st["stage2"]:
        a = findings_ans.get(finding_key(r))
        v = a["answer"]["verdict"] if a else auto_answer(r)[0]
        if v in USEFUL + ("FALSE",):
            s2_n += 1
            s2_true += v in USEFUL
    s4 = [findings_ans[finding_key(r)]["answer"]["verdict"] for r in st["stage4"] if finding_key(r) in findings_ans]
    s4_j = [v for v in s4 if v in USEFUL + ("FALSE",)]
    # boundaries of the real quotes you labelled: a cut is the engine's fault unless you said the ASR garbled it
    cuts = [findings_ans[finding_key(r)]["answer"] for r in st["stage2"] + st["stage4"] if finding_key(r) in findings_ans]
    cuts = [a for a in cuts if a["verdict"] in WITH_BOUNDARY and a.get("boundary")]
    if cuts:
        eng_cut = sum(1 for a in cuts if a["boundary"] != "COMPLETE_SPAN" and not a.get("not_engine_fault"))
        asr_cut = sum(1 for a in cuts if a.get("not_engine_fault"))
        rep["real quotes complete"] = pct(sum(a["boundary"] == "COMPLETE_SPAN" for a in cuts), len(cuts))
        rep["cut short by the engine"] = pct(eng_cut, len(cuts))
        rep["cut short by the ASR (not engine)"] = pct(asr_cut, len(cuts))
        rep["real quotes with a wrong / incomplete reference"] = pct(sum(1 for a in cuts if a.get("ref_issue")), len(cuts))
    # quotes with the sheikh's words inserted: did the engine notice (split the finding into several segments)?
    ins = [r for r in st["stage2"] + st["stage4"]
           if finding_key(r) in findings_ans and findings_ans[finding_key(r)]["answer"].get("has_insertion")]
    if ins:
        rep["quotes with sheikh's words inside: engine split them"] = pct(
            sum(1 for r in ins if len(r["det"].get("segments") or []) > 1), len(ins))
    rep["findings"] = len(st["stage2"]) + len(st["stage4"])
    rep["GT-matched findings real quotes (incl. by meaning)"] = pct(s2_true, s2_n)
    rep["other findings reviewed"] = f"{len(s4)}/{len(st['stage4'])}"
    if s4_j:
        p4 = sum(v in USEFUL for v in s4_j) / len(s4_j)
        est = (s2_true + p4 * len(st["stage4"])) / max(1, s2_n + len(st["stage4"]))
        rep["precision (estimate)"] = round(est, 3)
        rep["± (stage-4 sample)"] = round(1.96 * math.sqrt(p4 * (1 - p4) / len(s4_j)) * len(st["stage4"]) / max(1, s2_n + len(st["stage4"])), 3)
    return rep


# ---------------------------------------------------------------------------------------------- human labels -> Laya
def human_records(bundles: Dict[str, Dict[str, Any]], findings_ans: Dict[str, Any], engine: str) -> List[Dict[str, Any]]:
    """Records carrying your stage-2/4 labels (Unsure kept: Laya can learn NOT_SURE from you, D5)."""
    out = []
    for b in bundles.values():
        for r in b["records"]:
            if r["engine"] != engine:
                continue
            a = findings_ans.get(finding_key(r))
            if a:
                rr = dict(r)
                rr["label"] = {"tier": "human", "human": True, "verdict": a["answer"]["verdict"],
                               "boundary": a["answer"].get("boundary"),
                               "flags": [f for f in ("not_engine_fault", "ref_issue", "has_insertion") if a["answer"].get(f)]
                                        + (["in_hadith"] if a["answer"]["verdict"] == "IN_HADITH" else [])}
                out.append(rr)
    return out
