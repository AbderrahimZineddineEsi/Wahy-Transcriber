"""Stage 6 · negatives sprint: more "not a quote" findings for fewer cards.

Pool = stage-4 findings (no GT quote) you have not labelled yet. Three disjoint queues, frozen once assigned so
re-running (or adding lessons) never moves a card from one queue to another:
  gemini      Gemini says not a quote / unsure / P(not a quote) >= 0.2, or Gemini and JEV disagree
  suspicious  ranked by rules learned from your first 26 negatives (narrator chains, CANDIDATE band, no cue, ...)
  random      a random sample of the rest: shows what the other two queues miss
Answers go to labels/sprint.json, not findings.json: the queues are not random samples, so they must stay out of
the engine's precision estimate.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

from .cache import sha, write_atomic
from .stages import finding_key, pct

STORE = "sprint"
QUEUES = ("gemini", "suspicious", "random")
# PARAPHRASE kept apart (not folded into FALSE) so training can decide later what "by meaning" should teach Laya
CHOICES = {"FALSE": "✘ Not a quote", "CORRECT": "✔ Real quote", "PARAPHRASE": "≈ Quoted by meaning", "NOT_SURE": "? Unsure"}

# narrator-chain words (حدثنا فلان عن فلان بن فلان): 11 of 11 such findings were false in stage 4
_NARR = re.compile(r"^(و?حدثنا|و?حدثني|و?أخبرنا|و?أخبرني|أنبأنا|و?عن|بن|ابن|أبي|أبو|أبا|قال|قالوا|قالت|رضي|عنه|عنهما|عنها|عنهم)$")
_PUNCT = "،.,:؛\"«»()!؟?"


def pool(st: Dict[str, Any], findings_ans: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [r for r in st["stage4"] if finding_key(r) not in findings_ans]


def narrator_share(span: str) -> float:
    w = span.split()
    return sum(bool(_NARR.match(x.strip(_PUNCT))) for x in w) / max(1, len(w))


def suspicion(r: Dict[str, Any]) -> Tuple[int, List[str]]:
    """Higher = more likely not a quote. Weights from stage 4: CANDIDATE 26% false vs 4% for the other bands,
    neg_weak tier 56%, no cue 18% vs 5%, <=3 words 45%, interrupted 0/30, >15 words 1/61."""
    d, s = r["det"], r["envelope"]["state"]
    n = d["wordEndIdx"] - d["wordStartIdx"] + 1
    rules = [
        (4, "narrator chain", narrator_share(s["matched_span_in_lecture"]) >= 0.3),
        (3, "CANDIDATE band", d.get("confidenceBand") == "CANDIDATE"),
        (3, "sheikh's text, no quote marked", r["label"]["tier"] == "neg_weak"),
        (2, "no cue", not d.get("hasCitationCue")),
        (2, "≤3 words", n <= 3),
        (1, "4–5 words", 3 < n <= 5),
        (1, "after يعني / أي / قوله", bool(re.search(r"(يعني|أي|قوله)\s*$", s["immediate_transcript_before"]))),
        (-2, "long (>15 words)", n > 15),
        (-2, "sheikh's words inside", "interrupted" in r["cases"]),
    ]
    hit = [(w, why) for w, why, on in rules if on]
    return sum(w for w, _ in hit), [why for _, why in hit]


def _gemini_pick(g: Dict[str, Any], j: Dict[str, Any]) -> bool:
    return g["verdict"] != "CORRECT" or g["probs"]["FALSE"] >= 0.2 or g["verdict"] != j["verdict"]


def build_queues(pool_: List[Dict[str, Any]], gemini: List[Dict[str, Any]], jev: List[Dict[str, Any]],
                 n_suspicious: int = 60, n_random: int = 30, seed: int = 11) -> Dict[str, List[Dict[str, Any]]]:
    """gemini / jev = the models' answers, aligned with pool_. Assignments persist in labels/sprint_queues.json."""
    from .cards import LABELS_DIR
    path = LABELS_DIR / "sprint_queues.json"
    frozen: Dict[str, str] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    keys = [finding_key(r) for r in pool_]
    free = [i for i, k in enumerate(keys) if k not in frozen]

    for i in free:
        if _gemini_pick(gemini[i], jev[i]):
            frozen[keys[i]] = "gemini"
    free = [i for i in free if keys[i] not in frozen]
    room = n_suspicious - sum(frozen.get(k) == "suspicious" for k in keys)
    for i in sorted(free, key=lambda i: -suspicion(pool_[i])[0])[:max(0, room)]:
        frozen[keys[i]] = "suspicious"
    free = [i for i in free if keys[i] not in frozen]
    room = n_random - sum(frozen.get(k) == "random" for k in keys)
    for i in sorted(free, key=lambda i: sha("sprint", seed, keys[i]))[:max(0, room)]:
        frozen[keys[i]] = "random"
    write_atomic(path, json.dumps(frozen, ensure_ascii=False, indent=0).encode("utf-8"))

    order = {
        "gemini": lambda i: -gemini[i]["probs"]["FALSE"],
        "suspicious": lambda i: -suspicion(pool_[i])[0],
        "random": lambda i: sha("sprint", seed, keys[i]),
    }
    return {q: [pool_[i] for i in sorted((i for i, k in enumerate(keys) if frozen.get(k) == q), key=order[q])]
            for q in QUEUES}


def summary(items: List[Dict[str, Any]], ans: Dict[str, Any], queues: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Any]:
    done = Counter(ans[finding_key(r)]["answer"] for r in items if finding_key(r) in ans)
    n = sum(done.values())
    every = Counter(ans[finding_key(r)]["answer"] for q in queues.values() for r in q if finding_key(r) in ans)
    return {"reviewed": n, "of": len(items), "not quotes": pct(done["FALSE"], n), "real": done["CORRECT"],
            "by meaning": done["PARAPHRASE"], "unsure": done["NOT_SURE"], "negatives found (all queues)": every["FALSE"]}


def reviewer(queues: Optional[Dict[str, List[Dict[str, Any]]]], queue: str, bundles: Dict[str, Dict[str, Any]]):
    """Fast card: one click = answer + next card."""
    from . import cards
    if queues is None:
        print("no queues: the prepare cell above skipped the models (set RUN_MODELS = True in Setup and re-run it)")
        return None
    return cards.Reviewer(queues[queue], STORE, key=finding_key, mode="choice", choices=CHOICES,
                          render=lambda r: cards.render_finding(r, bundles[r["_bundle"]], ctx=16),
                          summary=lambda items, ans: summary(items, ans, queues))


def results(queues: Optional[Dict[str, List[Dict[str, Any]]]], ans: Dict[str, Any], pool_: List[Dict[str, Any]],
            preds: Dict[str, List[Dict[str, Any]]]):
    """Per queue: how many negatives it gave, and how each model does on the cards you answered there (a table)."""
    import pandas as pd
    if queues is None:
        return "no queues: the prepare cell skipped the models"
    idx = {finding_key(r): i for i, r in enumerate(pool_)}
    rows = []
    for q, items in list(queues.items()) + [("all", [r for its in queues.values() for r in its])]:
        done = [(idx[finding_key(r)], ans[finding_key(r)]["answer"]) for r in items if finding_key(r) in ans]
        c = Counter(a for _, a in done)
        row = {"queue": q, "cards": len(items), "reviewed": len(done), "not a quote": c["FALSE"],
               "real": c["CORRECT"], "by meaning": c["PARAPHRASE"], "unsure": c["NOT_SURE"],
               "hit rate": pct(c["FALSE"], len(done))}
        for m, p in preds.items():      # models only answer real / not: "by meaning" and "unsure" are not scored

            real = [p[i]["verdict"] for i, a in done if a == "CORRECT"]
            fake = [p[i]["verdict"] for i, a in done if a == "FALSE"]
            row[f"{m}: keeps real quotes"] = pct(real.count("CORRECT"), len(real))
            row[f"{m}: rejects false findings"] = pct(fake.count("FALSE"), len(fake))
        rows.append(row)
    return pd.DataFrame(rows).set_index("queue").T
