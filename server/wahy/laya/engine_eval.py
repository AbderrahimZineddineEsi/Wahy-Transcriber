"""Engine comparison on the 15 hand-reviewed Bin Baz lessons (engine v5 work, docs/plans/engine-v5-handoff.md).

  load()        the review bundles with the cached v3 / v4 records (same lessons and processing as laya_review.ipynb)
  add_engine()  runs ONE more engine (e.g. v5 from js/engine_v5.js) on those lessons and adds its labelled records,
                without re-running v3 / v4: editing engine_v5.js only re-detects v5
  verdicts()    one verdict per finding key: your labels > automatic GT label > Sonnet
  report() / diff()  recall vs GT and precision from those verdicts; what a new engine adds / loses vs a base engine
"""
from __future__ import annotations

import json
import pickle
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import asr as asr_mod
from . import pipeline, stages
from .cache import DATA_DIR, JsonCache, sha
from .engine_bridge import REPO_ROOT, EngineBridge
from .label import DocCtx, label_detection
from .sources import binbaz

HADITH_CORPUS = str(REPO_ROOT / "data/corpora/hadith_open_hadith_data.json")
# the 15 lessons of the review stages: same series and counts as notebooks/data/laya_review.ipynb
SERIES = {
    "riyad": "https://binbaz.org.sa/audios/series/29/%D8%B1%D9%8A%D8%A7%D8%B6-%D8%A7%D9%84%D8%B5%D8%A7%D9%84%D8%AD%D9%8A%D9%86-%D8%A7%D9%84%D8%B4%D8%B1%D8%AD-%D8%A7%D9%84%D8%A7%D9%88%D9%84",
    "tawhid_khuz": "https://binbaz.org.sa/audios/series/79/%D9%83%D8%AA%D8%A7%D8%A8-%D8%A7%D9%84%D8%AA%D9%88%D8%AD%D9%8A%D8%AF-%D9%84%D8%A7%D8%A8%D9%86-%D8%AE%D8%B2%D9%8A%D9%85%D8%A9",
    "aqeedah": "https://binbaz.org.sa/audios/series/40/%D8%AF%D8%B1%D9%88%D8%B3-%D9%81%D9%8A-%D8%A7%D9%84%D8%B9%D9%82%D9%8A%D8%AF%D8%A9",
    "phone": "https://binbaz.org.sa/audios/series/56/%D9%85%D8%AD%D8%A7%D8%B6%D8%B1%D8%A7%D8%AA-%D8%B9%D8%A8%D8%B1-%D8%A7%D9%84%D9%87%D8%A7%D8%AA%D9%81",
    "misc": "https://binbaz.org.sa/audios/series/43/%D8%AF%D8%B1%D9%88%D8%B3-%D9%85%D9%86%D9%88%D8%B9%D8%A9",
    "radio": "https://binbaz.org.sa/audios/series/20/%D8%A7%D8%AD%D8%A7%D8%AF%D9%8A%D8%AB-%D9%85%D9%86-%D8%A7%D9%84%D8%A7%D8%B0%D8%A7%D8%B9%D8%A9",
}
LESSONS = {"riyad": 5, "tawhid_khuz": 2, "aqeedah": 2, "phone": 2, "misc": 2, "radio": 3}
LABELS = DATA_DIR / "labels"
EVAL_STORE = "sonnet_engine_eval"          # Sonnet labels of spans only a new engine produces (kept out of sonnet.json)


def lessons() -> List[Tuple[binbaz.Lesson, Dict[str, Any]]]:
    from .lectures import REVIEWED
    out = []
    for series, n in LESSONS.items():
        for lesson in binbaz.usable_lessons(SERIES[series], n):
            if lesson.id not in REVIEWED:  # a lesson downloaded later for another batch (e.g. 1821) is not part of the review
                continue
            try:
                asr = asr_mod.transcribe(binbaz.download_mp3(lesson), backend="groq", model="whisper-large-v3-turbo")
            except Exception:            # skipped by the notebook too (e.g. a dead mp3 link)
                continue
            out.append((lesson, asr))
    return out


def load(engines: Tuple[str, ...] = ("v3", "v4")) -> Tuple[Dict[str, Dict[str, Any]], List[Tuple[binbaz.Lesson, Dict[str, Any]]]]:
    """Bundles of the usable lessons with `engines` records (cached by pipeline.process_cached), and the lessons."""
    ls = lessons()
    bundles = {}
    with EngineBridge(hadith_path=HADITH_CORPUS) as bridge:
        for lesson, asr in ls:
            b = pipeline.process_cached(lesson, asr, bridge, list(engines))
            if b["report"]["passed_gate"]:
                bundles[lesson.id] = b
    return bundles, [(l, a) for l, a in ls if l.id in bundles]


def load_lectures(yt: Dict[str, List[str]], binbaz_urls: List[str], engines: Tuple[str, ...] = ("v4",)):
    """The autolabel lecture set (lectures.YOUTUBE + lectures.BINBAZ, or the batch-2 lists): bundles with `engines`
    records, and the (lesson or None, asr) list for add_engine. Only cached audio / transcripts are used: a lecture
    that was never downloaded or transcribed is skipped (nothing is fetched and no transcription is paid for here)."""
    from .sources import youtube
    bundles, ls = {}, []
    with EngineBridge(hadith_path=HADITH_CORPUS) as bridge:
        for sheikh, vids in yt.items():
            for vid in vids:
                meta = youtube.LECTURES_DIR / f"yt_{vid}" / "meta.json"
                audio = youtube.AUDIO_DIR / f"yt_{vid}.mp3"
                if not (meta.exists() and audio.exists()):
                    continue
                v = youtube.Video(**json.loads(meta.read_text(encoding="utf-8")))
                hit = JsonCache("asr").get(sha(asr_mod._file_sha(audio), "groq", "whisper-large-v3-turbo"))
                if not hit:
                    continue
                bundles[v.id] = pipeline.process_no_gt(v.id, v.title, v.url, hit, bridge, list(engines))
                ls.append((v.id, None, hit))
        for url in binbaz_urls:
            les = binbaz.get_lesson(url)
            audio = DATA_DIR / "cache" / "audio" / f"{les.id}.mp3"
            hit = JsonCache("asr").get(sha(asr_mod._file_sha(audio), "groq", "whisper-large-v3-turbo")) if audio.exists() else None
            if not hit:
                continue
            b = pipeline.process_cached(les, hit, bridge, list(engines))
            if b["report"]["passed_gate"]:
                bundles[les.id] = b
                ls.append((les.id, les, hit))
    return bundles, ls


def _ctx(lesson: binbaz.Lesson, words: List[str], bridge: EngineBridge) -> DocCtx:
    """pipeline.build_ctx, with the GT parse + alignment cached on disk (they do not depend on the engines)."""
    p = DATA_DIR / "cache" / "engine_eval_ctx" / f"{sha(lesson.id, [b.text for b in lesson.blocks], words, pipeline.LABEL_VERSION)}.pkl"
    if p.exists():
        gt, al, asr_tokens, word_tok = pickle.loads(p.read_bytes())
    else:
        c = pipeline.build_ctx(lesson, words, bridge)
        gt, al, asr_tokens, word_tok = c.gt, c.al, c.asr_tokens, c.word_tok
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(pickle.dumps((gt, al, asr_tokens, word_tok)))
    nw = bridge.tokenize_words
    cache: Dict[str, Optional[List[str]]] = {}

    def unit_norms(uid: str) -> Optional[List[str]]:
        if uid not in cache:
            cache[uid] = bridge.unit_norms([uid]).get(uid)
        return cache[uid]

    return DocCtx(gt, al, asr_tokens, word_tok, lambda t: sum(nw(t.split()), []), unit_norms)


def add_engine(bundles: Dict[str, Dict[str, Any]], ls: List[Tuple[Any, ...]], engine: str = "v5",
               extra_engine_files: Optional[List[str]] = None, cache: bool = True,
               opts: Optional[Dict[str, Any]] = None) -> None:
    """Detect with `engine` on every lesson and add its records to the bundles (replacing earlier ones of that engine).
    Cached on (lesson, ASR, engine/corpus fingerprint, label logic): only an edit of the engine files re-detects.
    `engine` = "v5/<tag>" + `opts` = v5 with params.v5 = opts, e.g. {"fix": {"variants": False}} to measure one fix."""
    files = extra_engine_files if extra_engine_files is not None else [f"js/engine_{re.split(r'[/@:]', engine)[0]}.js"]
    store = JsonCache("engine_eval_records")
    with EngineBridge(hadith_path=HADITH_CORPUS, extra_engine_files=files) as bridge:
        fp = bridge.fingerprint()
        for item in ls:
            doc_id, lesson, asr = item if len(item) == 3 else (item[0].id, item[0], item[1])
            b = bundles[doc_id]
            key = sha(doc_id, asr["audio_sha"], fp, engine, opts, pipeline.LABEL_VERSION)
            recs = store.get(key) if cache else None
            if recs is None:
                words = [w["word"] for w in asr["words"]]
                ctx = _ctx(lesson, words, bridge) if lesson is not None else None     # None: no written text (YouTube)
                recs = []
                for d in bridge.detect(engine, words, opts):
                    lab = label_detection(d, ctx) if ctx else None
                    recs.append({
                        "id": f"{doc_id}:{engine}:{d['wordStartIdx']}-{d['wordEndIdx']}:{d.get('unitId')}",
                        "doc_id": doc_id, "engine": engine, "det": {k: v for k, v in d.items() if k != "envelope"},
                        "envelope": d["envelope"],
                        "label": ({"tier": lab.tier, "verdict": lab.verdict, "boundary": lab.boundary,
                                   "flags": lab.flags, "gt_unit": lab.gt_unit} if lab else
                                  {"tier": "no_gt", "verdict": None, "boundary": None, "flags": [], "gt_unit": None}),
                        "cases": [],
                    })
                if cache:
                    store.put(key, recs)
            b["records"] = [r for r in b["records"] if r["engine"] != engine] + recs


# ---------------------------------------------------------------------------------------------- verdicts
def _load(name: str) -> Dict[str, Any]:
    p = LABELS / f"{name}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def label_stores() -> Dict[str, Dict[str, Any]]:
    return {"human": _load("findings"), "sprint": _load("sprint"), "sonnet": {**_load("sonnet"), **_load(EVAL_STORE)}}


def verdict(r: Dict[str, Any], stores: Dict[str, Dict[str, Any]]) -> Tuple[Optional[str], str]:
    """(verdict, source). Source: human > sprint (your negatives sprint) > auto (GT finding) > sonnet > none."""
    k = stages.finding_key(r)
    if k in stores["human"]:
        return stores["human"][k]["answer"]["verdict"], "human"
    if k in stores["sprint"]:
        a = stores["sprint"][k]["answer"]
        return (a if isinstance(a, str) else a["verdict"]), "sprint"
    if stages.is_gt_finding(r):
        v = stages.auto_answer(r)[0]
        if v:
            return v, "auto"
    if k in stores["sonnet"]:
        return stores["sonnet"][k]["answer"]["verdict"], "sonnet"
    return None, "none"


def _recs(bundles: Dict[str, Dict[str, Any]], engine: str) -> List[Dict[str, Any]]:
    out = []
    for doc_id, b in bundles.items():
        for r in b["records"]:
            if r["engine"] == engine:
                r["_bundle"] = doc_id
                out.append(r)
    return out


def _inherited(r: Dict[str, Any], base: List[Dict[str, Any]], stores: Dict[str, Dict[str, Any]]) -> Optional[str]:
    """Verdict of an overlapping finding of the same unit in `base` (a re-spanned finding is still the same quote)."""
    d = r["det"]
    for o in base:
        od = o["det"]
        if o["doc_id"] == r["doc_id"] and od.get("unitId") == d.get("unitId") and \
                od["wordStartIdx"] <= d["wordEndIdx"] and d["wordStartIdx"] <= od["wordEndIdx"]:
            v = verdict(o, stores)[0]
            if v:
                return v
    return None


def precision(recs: List[Dict[str, Any]], stores: Dict[str, Dict[str, Any]],
              base: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Verdict counts. With `base`, an unlabelled finding takes the verdict of an overlapping same-unit base finding."""
    n_true = n_false = unsure = none = 0
    for r in recs:
        v, _ = verdict(r, stores)
        if v is None and base is not None:
            v = _inherited(r, base, stores)
        if v in stages.USEFUL:
            n_true += 1
        elif v == "FALSE":
            n_false += 1
        elif v == "NOT_SURE":
            unsure += 1
        else:
            none += 1
    j = n_true + n_false
    return {"findings": len(recs), "useful": n_true, "false": n_false, "unsure": unsure, "unlabelled": none,
            "precision": round(n_true / j, 3) if j else None}


def report(bundles: Dict[str, Dict[str, Any]], engines: List[str]) -> List[Dict[str, Any]]:
    stores = label_stores()
    rows = []
    rec = {(x["engine"], x["type"]): x for x in stages.recall_table(bundles, engines)}
    base = _recs(bundles, "v4") if any(r["engine"] == "v4" for b in bundles.values() for r in b["records"]) else None
    for e in engines:
        p = precision(_recs(bundles, e), stores)
        pi = precision(_recs(bundles, e), stores, base) if base is not None and e != "v4" else p
        rows.append({"engine": e, "recall Quran": rec[(e, "QURAN")]["recall"], "recall hadith": rec[(e, "HADITH")]["recall"],
                     "recall all": rec[(e, "ALL")]["recall"], "caught": rec[(e, "ALL")]["caught"],
                     "alignable": rec[(e, "ALL")]["alignable"], **p,
                     "unlabelled after inheriting v4 verdicts": pi["unlabelled"], "precision (inherited)": pi["precision"]})
    return rows


def diff(bundles: Dict[str, Dict[str, Any]], base: str = "v4", new: str = "v5") -> Dict[str, Any]:
    """What `new` changes vs `base`: GT quotes gained / lost, and findings added / dropped / re-spanned, with verdicts."""
    stores = label_stores()
    st = stages.build({k: b for k, b in bundles.items() if "gt" in b.get("doc", {})}, new, [base, new])   # GT lessons only
    al = [i for i in st["gt"] if i["alignable"]]
    gained = [i for i in al if new in i["caught_by"] and base not in i["caught_by"]]
    lost = [i for i in al if base in i["caught_by"] and new not in i["caught_by"]]
    B, N = _recs(bundles, base), _recs(bundles, new)

    def same_find(r, others, any_unit=False):
        d = r["det"]
        for o in others:
            od = o["det"]
            if o["doc_id"] == r["doc_id"] and od["wordStartIdx"] <= d["wordEndIdx"] and d["wordStartIdx"] <= od["wordEndIdx"]:
                if any_unit or o["det"].get("unitId") == d.get("unitId"):
                    return o
        return None

    bkeys = {stages.finding_key(r) for r in B}
    nkeys = {stages.finding_key(r) for r in N}
    added, respanned, rereferenced, dropped = [], [], [], []
    for r in N:
        if stages.finding_key(r) in bkeys:
            continue
        o = same_find(r, B)
        if o:
            respanned.append((r, o))
        elif same_find(r, B, any_unit=True):
            rereferenced.append((r, same_find(r, B, any_unit=True)))
        else:
            added.append((r, None))
    for r in B:
        if stages.finding_key(r) in nkeys:
            continue
        if not same_find(r, N, any_unit=True):
            dropped.append(r)

    def tally(rs):
        c: Dict[str, int] = {}
        for r in rs:
            v, src = verdict(r, stores)
            c[str(v)] = c.get(str(v), 0) + 1
        return c

    return {"gained": gained, "lost": lost, "added": [r for r, _ in added], "respanned": respanned,
            "rereferenced": rereferenced, "dropped": dropped,
            "summary": {"GT gained": len(gained), "GT lost": len(lost), "findings added": len(added),
                        "added verdicts": tally([r for r, _ in added]), "dropped": len(dropped),
                        "dropped verdicts": tally(dropped), "re-spanned": len(respanned),
                        "other reference": len(rereferenced)}}


def show(r: Dict[str, Any], bundles: Dict[str, Dict[str, Any]], ctx: int = 8) -> str:
    """One finding as text: context «span» context  → ref  [band, verdict/source]."""
    d = r["det"]
    words = [w["word"] for w in bundles[r["doc_id"]]["asr_words"]]
    ws, we = d["wordStartIdx"], d["wordEndIdx"]
    v, src = verdict(r, label_stores())
    return (f"{' '.join(words[max(0, ws - ctx):ws])} «{' '.join(words[ws:we + 1])}» {' '.join(words[we + 1:we + 1 + ctx])}"
            f"  → {d.get('displayRef')} [{d.get('confidenceBand')} {d.get('totalScore')}, {v}/{src}]  {stages.finding_key(r)}")


def show_gt(it: Dict[str, Any], bundles: Dict[str, Dict[str, Any]], ctx: int = 6) -> str:
    words = [w["word"] for w in bundles[it["doc_id"]]["asr_words"]]
    ws, we = it["asr_ws"], it["asr_we"]
    return (f"{it['kind'][0]} {it.get('ref') or it.get('unit_id') or ''}: {' '.join(words[max(0, ws - ctx):ws])} "
            f"«{' '.join(words[ws:we + 1])}» {' '.join(words[we + 1:we + 1 + ctx])}  {it['key']}")


def boundaries(bundles: Dict[str, Dict[str, Any]], engines: List[str], base: str = "v4") -> List[Dict[str, Any]]:
    """Span quality. (1) GT findings: share whose automatic boundary (vs the quote marked in the written text) is
    Complete. (2) Re-spanned findings vs `base`, judged by your boundary label of the base finding: a start / end that
    moved outward is a fix when you said that side was missing, an overshoot when you said Complete; moved inward is a
    new cut unless that side was already missing."""
    stores = label_stores()
    rows = []
    B = {stages.finding_key(r): r for r in _recs(bundles, base)}
    for e in engines:
        gt = [r for r in _recs(bundles, e) if r["label"]["tier"] == "pos_strong" and r["label"].get("boundary")]
        c = sum(r["label"]["boundary"] == "COMPLETE_SPAN" for r in gt)
        row = {"engine": e, "GT findings with a boundary": len(gt), "complete": stages.pct(c, len(gt))}
        if e != base:
            fixed = over = cut = 0
            for r in _recs(bundles, e):
                if stages.finding_key(r) in B:
                    continue
                d = r["det"]
                for o in B.values():
                    od = o["det"]
                    if o["doc_id"] != r["doc_id"] or od.get("unitId") != d.get("unitId") or od["wordStartIdx"] > d["wordEndIdx"] or d["wordStartIdx"] > od["wordEndIdx"]:
                        continue
                    a = stores["human"].get(stages.finding_key(o))
                    bd = a["answer"].get("boundary") if a else (o["label"].get("boundary") if o["label"]["tier"] == "pos_strong" else None)
                    if not bd:
                        break
                    miss_s, miss_e = bd in ("MISSING_START", "MISSING_BOTH"), bd in ("MISSING_END", "MISSING_BOTH")
                    for moved, missing in ((od["wordStartIdx"] - d["wordStartIdx"], miss_s), (d["wordEndIdx"] - od["wordEndIdx"], miss_e)):
                        if moved > 0:
                            fixed += missing
                            over += not missing
                        elif moved < 0 and not missing:
                            cut += 1
                    break
            row.update({"re-span: missing side extended": fixed, "complete side extended (overshoot?)": over,
                        "side cut": cut})
        rows.append(row)
    return rows


def unlabelled(bundles: Dict[str, Dict[str, Any]], engines: List[str]) -> List[Dict[str, Any]]:
    """Findings of `engines` with no verdict yet (no label of yours, no automatic GT label, no Sonnet label), one per
    finding key, in a stable shuffled order: the pool for autolabel.run(..., store=EVAL_STORE)."""
    stores = label_stores()
    out, seen = [], set()
    for e in engines:
        for r in _recs(bundles, e):
            k = stages.finding_key(r)
            if k in seen or verdict(r, stores)[0] is not None:
                continue
            seen.add(k)
            out.append(r)
    return sorted(out, key=lambda r: sha(5, stages.finding_key(r)))
