"""Stage 7 · AI labeller test: can a Claude model (Sonnet) label findings the way you do?

prepare()  picks 30 cards you labelled and writes a BLIND folder outside the repo: the cards as plain text (what your
           review card showed, minus audio), the labelling rules, and a tiny CLI that records each answer with its time.
           Nothing in that folder reveals your answer; the card -> label key map stays in the repo.
report()   compares the model's answers with yours (and with Gemini / JEV on the same cards), plus the time it took.
"""
from __future__ import annotations

import json
import random
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional

from .cache import DATA_DIR, write_atomic
from .stages import BOUNDARY, VERDICT, finding_key

KEY_DIR = DATA_DIR / "agent_eval"
CTX = 28
CORPUS_CTX = 30
REAL = ("CORRECT", "IN_HADITH")

# how many cards of each kind of YOUR answer go into the test (30 in all)
MIX = {"FALSE": 10, "PARAPHRASE": 4, "COMPLETE_SPAN": 5, "MISSING_END": 3, "MISSING_START": 2, "MISSING_BOTH": 2,
       "REAL_NO_BOUNDARY": 4}


# ---------------------------------------------------------------------------------------------- plain-text cards
def _marked(words: List[str], lo: int, hi: int, cls: Dict[int, str]) -> str:
    """words[lo:hi] with runs wrapped: m = ⟦detected⟧, g = ⟪quote marked in the written text⟫, mg = both."""
    wrap = {"m": ("⟦", "⟧"), "g": ("⟪", "⟫"), "mg": ("⟦⟪", "⟫⟧"), "": ("", "")}
    out, cur, buf = [], None, []
    for i in list(range(max(0, lo), min(len(words), hi))) + [None]:
        c = cls.get(i, "") if i is not None else None
        if c != cur and buf:
            a, z = wrap[cur]
            out.append(a + " ".join(buf) + z)
            buf = []
        cur = c
        if i is not None:
            buf.append(words[i])
    return " ".join(out)


def card_text(cid: str, r: Dict[str, Any], b: Dict[str, Any]) -> str:
    d, doc = r["det"], b["doc"]
    ws, we = d["wordStartIdx"], d["wordEndIdx"]
    words = [w["word"] for w in b["asr_words"]]
    t0 = b["asr_words"][ws]["start"]
    asr = _marked(words, ws - CTX, we + 1 + CTX, {i: "m" for i in range(ws, we + 1)})

    g = []
    if "gt" in doc:                      # lectures without a written transcript (YouTube) have no GT section
        a2g, wt, tw = doc["asr2gt"], doc["word_tok"], doc["gt"]["tok_word"]
        g = [a2g[t] for t in range(wt[ws], wt[we + 1]) if a2g[t] >= 0]
    if g:
        gw0, gw1 = tw[min(g)], tw[max(g)]
        cls: Dict[int, str] = {}
        for q in doc["gt"]["quran"] + doc["gt"]["hadith"]:
            if q["gt_start"] <= max(g) and q["gt_end"] > min(g) - 40:
                for t in range(q["gt_start"], q["gt_end"]):
                    cls[tw[t]] = "g"
        for i in range(gw0, gw1 + 1):
            cls[i] = "mg" if cls.get(i) == "g" else "m"
        gt = _marked(doc["gt"]["words"], gw0 - CTX, gw1 + 1 + CTX, cls)
    else:
        gt = "(this part of the speech could not be matched to the written text)"

    uw, segs = d.get("unit_words") or [], d.get("qSegments") or []
    if uw:
        lo = max(0, (segs[0][0] if segs else 0) - CORPUS_CTX)
        hi = min(len(uw), (segs[-1][1] if segs else len(uw)) + CORPUS_CTX)
        corpus = (("… " if lo > 0 else "") + _marked(uw, lo, hi, {i: "m" for a, z in segs for i in range(a, z)})
                  + (" …" if hi < len(uw) else ""))
    else:
        corpus = r["envelope"]["state"].get("canonical_corpus_text", "")

    src = {"QURAN": "Quran", "HADITH": "Hadith", "ADHKAR": "Dhikr"}.get(d["sourceType"], d["sourceType"])
    written = (f"## Bin Baz written text at this spot (words aligned with the detection in ⟦ ⟧; a quote marked in the written text in ⟪ ⟫)\n{gt}\n\n"
               if "gt" in doc else "")
    return (f"# Card {cid}\n"
            f"{src} · reference: {d.get('displayRef', '')} · engine band: {d.get('confidenceBand', '')} · "
            f"lesson: {doc['title'][:60]} · at {int(t0 // 60)}:{int(t0 % 60):02d} · {we - ws + 1} words\n\n"
            f"## What was said (speech-to-text; detected words in ⟦ ⟧)\n{asr}\n\n"
            f"{written}"
            f"## Original text from the corpus (matched part in ⟦ ⟧)\n{corpus}\n")


# ---------------------------------------------------------------------------------------------- picking the 30 cards
def _kind(a: Any) -> Optional[str]:
    """Your answer -> the MIX bucket it falls in (sprint answers are plain verdict strings, no boundary)."""
    if isinstance(a, str):
        return {"FALSE": "FALSE", "PARAPHRASE": "PARAPHRASE", "CORRECT": "REAL_NO_BOUNDARY"}.get(a)
    if a["verdict"] in ("FALSE", "PARAPHRASE"):
        return a["verdict"]
    if a["verdict"] in REAL and a.get("boundary"):
        return a["boundary"]
    return None




def _key_map_path(rnd: str) -> Path:
    return KEY_DIR / f"key_map_{rnd}.json"


def prepare(st: Dict[str, Any], bundles: Dict[str, Dict[str, Any]], blind_dirs, rnd: str = "r1", seed: int = 5) -> None:
    """Draw 30 cards not used in an earlier round and write the same blind folder to every dir in blind_dirs
    (one per model / effort, so each session runs alone)."""
    from . import cards
    from .teachers.gemini import GeminiTeacher
    from .teachers.jev import JevTeacher
    blind_dirs = [Path(blind_dirs)] if isinstance(blind_dirs, (str, Path)) else [Path(d) for d in blind_dirs]
    if _key_map_path(rnd).exists():
        print(f"round {rnd} already prepared:", ", ".join(map(str, blind_dirs)))
        return
    used = {v["key"] for f in KEY_DIR.glob("key_map_*.json") for v in json.loads(f.read_text(encoding="utf-8")).values()}
    recs = {finding_key(r): r for r in st["stage2"] + st["stage4"]}
    labels = [("findings", k, v["answer"]) for k, v in cards.load_answers("findings").items()]
    labels += [("sprint", k, v["answer"]) for k, v in cards.load_answers("sprint").items()]
    buckets: Dict[str, List] = {}
    for src, k, a in labels:
        if k in recs and k not in used and _kind(a):
            buckets.setdefault(_kind(a), []).append((src, k))
    rng = random.Random(seed)
    picked = []
    for kind, n in MIX.items():
        pool = sorted(set(buckets.get(kind, [])))
        picked += rng.sample(pool, min(n, len(pool)))
    rng.shuffle(picked)

    gem, jev = GeminiTeacher("gemini-3.5-flash-lite"), JevTeacher()
    key_map, blind = {}, []
    for i, (src, k) in enumerate(picked, 1):
        cid, r = f"c{i:02d}", recs[k]
        blind.append({"id": cid, "text": card_text(cid, r, bundles[r["_bundle"]])})
        key_map[cid] = {"key": k, "labels": src, "ref": r["det"].get("displayRef", ""),
                        "span": r["envelope"]["state"]["matched_span_in_lecture"],
                        "gemini": gem.key(r["envelope"]), "jev": jev.key(r["envelope"])}
    # the template is not called CLAUDE.md in the repo: it would be loaded as instructions by any session working there
    tpl = Path(__file__).parent / "agent_eval_files"
    for d in blind_dirs:
        write_atomic(d / "cards.json", json.dumps(blind, ensure_ascii=False, indent=1).encode("utf-8"))
        write_atomic(d / "CLAUDE.md", (tpl / "instructions.md").read_bytes())
        write_atomic(d / "label.py", (tpl / "label.py").read_bytes())
        deny = [Path(__file__).resolve().parents[2], DATA_DIR.resolve()] + [o.resolve() for o in blind_dirs if o != d]
        settings = {"permissions": {"allow": ["Bash(python3 label.py:*)"], "deny": [f"Read(/{x}/**)" for x in deny]}}
        write_atomic(d / ".claude" / "settings.json", json.dumps(settings, indent=2).encode("utf-8"))
    write_atomic(KEY_DIR / f"cards_{rnd}.json", json.dumps(blind, ensure_ascii=False, indent=1).encode("utf-8"))
    write_atomic(_key_map_path(rnd), json.dumps(key_map, ensure_ascii=False, indent=1).encode("utf-8"))
    print(f"round {rnd}: {len(blind)} cards in", ", ".join(map(str, blind_dirs)),
          dict(Counter(_kind(a) for s, k, a in labels if (s, k) in set(picked))))


# ---------------------------------------------------------------------------------------------- Gemini / JEV with the guide
GUIDED_VERSION = "1"
VERDICTS5 = ["CORRECT", "IN_HADITH", "PARAPHRASE", "FALSE", "NOT_SURE"]
BOUNDARIES = ["COMPLETE_SPAN", "MISSING_START", "MISSING_END", "MISSING_BOTH"]


def guide() -> str:
    """The blind folder's instructions without the section about the CLI: the same rules Sonnet labels with."""
    text = (Path(__file__).parent / "agent_eval_files" / "instructions.md").read_text(encoding="utf-8")
    a, b = text.index("## How to work"), text.index("## What a card shows")
    return text[:a] + text[b:]


def _gemini_guided(card: str) -> Dict[str, Any]:
    import httpx
    from .config import key
    schema = {"type": "OBJECT", "properties": {
        "verdict": {"type": "STRING", "enum": VERDICTS5},
        "boundary": {"type": "STRING", "enum": BOUNDARIES + ["NONE"]},
        "reason": {"type": "STRING"}}, "required": ["verdict", "boundary", "reason"]}
    body = {"systemInstruction": {"parts": [{"text": guide()}]},
            "contents": [{"role": "user", "parts": [{"text": card + "\n\nLabel this card. Give `boundary` only for CORRECT / "
                                                             "IN_HADITH (otherwise NONE) and a short `reason`."}]}],
            "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json", "responseSchema": schema}}
    for attempt in range(6):
        r = httpx.post("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
                       params={"key": key("GEMINI_API_KEY")}, json=body, timeout=120)
        if r.status_code in (429, 500, 503):
            import time
            time.sleep(min(60, 5 * 2 ** attempt))
            continue
        r.raise_for_status()
        d = r.json()
        a = json.loads(d["candidates"][0]["content"]["parts"][0]["text"])
        u = d.get("usageMetadata", {})
        return {"verdict": a["verdict"], "boundary": None if a["boundary"] == "NONE" else a["boundary"],
                "reason": a.get("reason", ""), "tokens_in": u.get("promptTokenCount", 0), "tokens_out": u.get("candidatesTokenCount", 0)}
    raise RuntimeError("gemini unavailable after retries")


def _jev_guided(card: str) -> Dict[str, Any]:
    import httpx
    from .config import key
    g = guide()
    questions = {
        "verdict": {"type": "choice", "instructions": g + "\n\nThe card is in `card`. Choose the verdict.",
                    "criteria": {"CORRECT": "a real quote of the shown reference",
                                 "IN_HADITH": "a verbatim verse quoted inside a hadith",
                                 "PARAPHRASE": "the text told by its meaning, mixed with the speaker's own words",
                                 "FALSE": "not a quote (chain of narrators / takhrij only, explanation with the text's words, ordinary speech, a formula, another text)",
                                 "NOT_SURE": "the evidence does not allow a decision"}},
        "boundary_status": {"type": "choice", "instructions": "Only meaningful for CORRECT / IN_HADITH, following the boundary rules above.",
                            "criteria": {"COMPLETE_SPAN": "nothing the speaker said was cut off",
                                         "MISSING_START": "words of this reference said right before the span were left out",
                                         "MISSING_END": "words of this reference said right after the span were left out",
                                         "MISSING_BOTH": "words were left out at both ends"}}}
    for attempt in range(4):
        r = httpx.post("https://openrouter.ai/api/alpha/decisions", headers={"Authorization": f"Bearer {key('OPENROUTER_API_KEY')}"},
                       json={"model": "typesafe/jev-1.14", "state": {"card": card}, "questions": questions}, timeout=60)
        if r.status_code in (429, 500, 502, 503, 504):
            import time
            time.sleep(2 ** attempt)
            continue
        r.raise_for_status()
        d = r.json()
        a = d["answers"]
        return {"verdict": a["verdict"]["choice"], "boundary": a.get("boundary_status", {}).get("choice"), "reason": "",
                "cost": float((d.get("usage") or {}).get("cost") or 0)}
    raise RuntimeError("JEV unavailable after retries")


GUIDED = {"Gemini + guide": _gemini_guided, "JEV + guide": _jev_guided}


def run_guided(rnd: str, allow_calls: bool = True) -> Dict[str, Dict[str, Any]]:
    """Gemini and JEV label the round's cards with the same guide and the same card text as Sonnet (cached)."""
    import time
    from .cache import JsonCache, sha
    cache = JsonCache("guided")
    cards_ = json.loads((KEY_DIR / f"cards_{rnd}.json").read_text(encoding="utf-8"))
    out: Dict[str, Dict[str, Any]] = {}
    for name, fn in GUIDED.items():
        out[name] = {}
        for c in cards_:
            k = sha(name, GUIDED_VERSION, guide(), c["text"])
            a = cache.get(k)
            if a is None and allow_calls:
                t0 = time.time()
                a = fn(c["text"])
                a["seconds"] = time.time() - t0
                cache.put(k, a)
                if name.startswith("Gemini"):
                    time.sleep(max(0.0, 5.0 - (time.time() - t0)))      # free tier ~12 requests / min
            if a is not None:
                out[name][c["id"]] = a
    return out


# ---------------------------------------------------------------------------------------------- the report
def _real_or_not(v: Optional[str]) -> Optional[str]:
    return "REAL" if v in REAL else "NOT" if v == "FALSE" else None


def session_usage(blind_dir: Path) -> Optional[Dict[str, int]]:
    """Token usage of the Claude Code session(s) run in blind_dir, read from their transcripts."""
    import re
    proj = Path.home() / ".claude" / "projects" / re.sub(r"[^A-Za-z0-9]", "-", str(Path(blind_dir).resolve()))
    seen, tot = set(), Counter()
    for f in proj.glob("*.jsonl"):
        for line in f.read_text(encoding="utf-8").splitlines():
            d = json.loads(line)
            m = d.get("message") or {}
            if d.get("type") != "assistant" or not m.get("usage") or m.get("id") in seen:
                continue
            seen.add(m.get("id"))
            tot["turns"] += 1
            for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"):
                tot[k] += m["usage"].get(k) or 0
    return dict(tot) if tot else None


def _sonnet_answers(blind_dir: Path) -> Dict[str, Any]:
    p = Path(blind_dir) / "answers.json"
    got = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    for a in got.values():
        if a.get("t_answered") and a.get("t_shown"):
            a["seconds"] = a["t_answered"] - a["t_shown"]
    return {c: a for c, a in got.items() if a.get("verdict")}


def report(runs, rnd: str = "r1") -> Optional[Dict[str, Any]]:
    """runs = a blind folder, or {name: blind folder} (one per Sonnet session). Compared with your labels, together with
    Gemini / JEV given the same guide, and Gemini / JEV with the app's prompt (stage 5 answers)."""
    from . import cards
    from .cache import JsonCache
    runs = {"Sonnet": Path(runs)} if isinstance(runs, (str, Path)) else {k: Path(v) for k, v in runs.items()}
    km_path = _key_map_path(rnd)
    key_map = json.loads(km_path.read_text(encoding="utf-8"))
    mine = {"findings": cards.load_answers("findings"), "sprint": cards.load_answers("sprint")}
    you = {}
    for cid, km in key_map.items():
        a = mine[km["labels"]][km["key"]]["answer"]
        you[cid] = (a, None) if isinstance(a, str) else (a["verdict"], a.get("boundary"))

    labellers: Dict[str, Dict[str, Any]] = {name: _sonnet_answers(d) for name, d in runs.items()}
    labellers.update(run_guided(rnd, allow_calls=False))
    gcache, jcache = JsonCache("teacher_gemini"), JsonCache("teacher_jev")
    for name, cache, f in (("Gemini (app prompt)", gcache, "gemini"), ("JEV (app prompt)", jcache, "jev")):
        labellers[name] = {cid: cache.get(km[f]) for cid, km in key_map.items() if cache.get(km[f])}
    if not any(labellers[n] for n in runs):
        print("no answers yet: run the model in the blind folder first")

    rows, dis = [], []
    for name, ans in labellers.items():
        done = [(cid, a) for cid, a in ans.items() if cid in you]
        if not done:
            continue
        rn = [(you[c][0], a["verdict"]) for c, a in done if _real_or_not(you[c][0])]
        real = [v for y, v in rn if y in REAL]
        fake = [v for y, v in rn if y == "FALSE"]
        bd = [(you[c][1], a.get("boundary")) for c, a in done if you[c][0] in REAL and a["verdict"] in REAL and you[c][1]]
        secs = [a["seconds"] for c, a in done if a.get("seconds")]
        row = {"labeller": name, "cards": len(done),
               "same verdict (5 options)": f"{sum(you[c][0] == a['verdict'] for c, a in done)}/{len(done)}",
               "keeps real quotes": f"{sum(v in REAL for v in real)}/{len(real)}",
               "rejects false findings": f"{sum(v == 'FALSE' for v in fake)}/{len(fake)}",
               "same boundary (both real)": f"{sum(x == y for x, y in bd)}/{len(bd)}" if bd else "—",
               "time": f"{sum(secs) / 60:.1f} min" if secs and name in runs else "—"}
        if name in runs:
            u = session_usage(runs[name])
            if u:
                row["tokens in (fresh / cache write / cache read)"] = (f"{u['input_tokens']:,} / {u['cache_creation_input_tokens']:,} / "
                                                                      f"{u['cache_read_input_tokens']:,}")
                row["tokens out"] = f"{u['output_tokens']:,}"
        rows.append(row)
        if name in runs or name.endswith("guide"):
            for c, a in done:
                y, yb = you[c]
                if y != a["verdict"] or (y in REAL and a["verdict"] in REAL and yb and yb != a.get("boundary")):
                    dis.append({"labeller": name, "card": c, "ref": key_map[c]["ref"], "span": key_map[c]["span"][:60],
                                "you": VERDICT.get(y, y) + (f" · {BOUNDARY[yb]}" if yb else ""),
                                "model": VERDICT.get(a["verdict"], a["verdict"]) + (f" · {BOUNDARY[a['boundary']]}" if a.get("boundary") and a["verdict"] in REAL else ""),
                                "reason": a.get("reason", "")})

    def table(rs: List[Dict[str, Any]]) -> List[str]:
        cols = list(dict.fromkeys(k for r in rs for k in r))
        return ["| " + " | ".join(cols) + " |", "|---" * len(cols) + "|"] + \
               ["| " + " | ".join(str(r.get(c, "")) for c in cols) + " |" for r in rs]

    md = [f"# AI labeller test — round {rnd}\n", *table(rows), "\n## Disagreements with you\n", *(table(dis) if dis else ["none"])]
    text = "\n".join(md)
    write_atomic(KEY_DIR / f"report_{rnd}.md", text.encode("utf-8"))
    return {"markdown": text, "rows": rows, "disagreements": dis}
