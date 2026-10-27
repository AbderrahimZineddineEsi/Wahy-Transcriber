"""JEV and base Laya on the full laya_v1 test set, with the exact state + questions the fine-tuned Laya sees.

The baselines in baselines.json are cached answers from the review stages: hard choices only, on 102–147 of your 198
cards, and base Laya on older envelopes. This re-asks them on all 1,523 test rows so every model is scored on the same
cards with the same input, and keeps JEV's probabilities (AUC, calibration).

    python -m backend.laya_datagen.teacher_eval jev              # ~$0.10, resumable (raw replies cached)
    python -m backend.laya_datagen.teacher_eval laya --model convaiinnovations/laya-multilingual --name "Laya (base)"
    python -m backend.laya_datagen.teacher_eval chat --model openai/gpt-4o-mini --name "GPT-4o mini"   # 100 + 100 cards
    python -m backend.laya_datagen.teacher_eval report           # every results/*.json side by side

Results go to data/laya_datagen/results/full_test/<name>.json, in eval_laya's format (predictions included).
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import sys
import time
from pathlib import Path

import httpx

from .cache import DATA_DIR
from .kaggle import eval_laya

TEST = DATA_DIR / "datasets" / "laya_v1" / "test.jsonl"
OUT = DATA_DIR / "results" / "full_test"
JEV_URL = "https://openrouter.ai/api/alpha/decisions"
JEV_MODEL = "typesafe/jev-1.14"


def _key() -> str:
    env = Path(__file__).resolve().parents[2] / ".env"
    for line in env.read_text().splitlines():
        if line.startswith("OPENROUTER_API_KEY="):
            return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit("OPENROUTER_API_KEY not in .env")


def _ask_jev(row, key, model, tries=5):
    body = {"model": model, "state": row["state"], "questions": row["questions"]}
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json",
               "HTTP-Referer": "https://wahy-transcriber.local", "X-Title": "Wahy Transcriber JEV eval"}
    for attempt in range(tries):
        try:
            r = httpx.post(JEV_URL, headers=headers, json=body, timeout=90)
            if r.status_code == 200:
                d = r.json()
                if all((d.get("answers") or {}).get(q, {}).get("choice") for q in row["questions"]):
                    return d
            err = f"HTTP {r.status_code}: {r.text[:200]}"
        except (httpx.HTTPError, ValueError) as e:
            err = str(e)
        time.sleep(2 ** attempt)
    return {"error": err}


def _to_p(reply, labels):
    """eval_laya's P entry: the reply's probabilities, or one-hot on the choice when they are missing."""
    a = reply.get("answers") or {}
    out = {}
    for q, opts in labels.items():
        x = a.get(q) or {}
        probs = {k: float(v) for k, v in (x.get("probabilities") or {}).items() if k in opts}
        if not probs and x.get("choice") in opts:
            probs = {k: float(k == x["choice"]) for k in opts}
        if probs:
            out[q] = probs
    return out


def _run_api(name, rows, ask, workers=6):
    """id -> raw reply for every row, asking `ask(row)` only for rows not cached yet (failed ones are asked again)."""
    raw_path = OUT / f"raw_{name.lower().replace(' ', '_')}.jsonl"
    OUT.mkdir(parents=True, exist_ok=True)
    done = {json.loads(l)["id"]: json.loads(l)["reply"] for l in raw_path.open(encoding="utf-8")} if raw_path.exists() else {}
    done = {k: v for k, v in done.items() if "error" not in v}
    todo = [r for r in rows if r["id"] not in done]
    print(f"{name}: {len(done)} cached, {len(todo)} to ask", flush=True)
    t0 = time.time()
    with raw_path.open("a", encoding="utf-8") as f, concurrent.futures.ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(ask, r): r for r in todo}
        for i, fut in enumerate(concurrent.futures.as_completed(futs), 1):
            r, reply = futs[fut], fut.result()
            done[r["id"]] = reply
            f.write(json.dumps({"id": r["id"], "reply": reply}, ensure_ascii=False) + "\n")
            f.flush()
            if i % 100 == 0:
                print(f"  {i}/{len(todo)}, {time.time() - t0:.0f}s", flush=True)
    return {r["id"]: done[r["id"]] for r in rows}


def run_jev(model=JEV_MODEL, name="JEV"):
    rows, key = eval_laya.read_jsonl(TEST), _key()
    done = _run_api(name, rows, lambda r: _ask_jev(r, key, model))
    labels = {"verdict": eval_laya.VERDICTS, "boundary_status": eval_laya.BOUNDARIES}
    P = {k: _to_p(v, labels) for k, v in done.items() if "error" not in v}
    failed = [k for k, v in done.items() if "error" in v]
    cost = sum(float((v.get("usage") or {}).get("cost") or 0) for v in done.values())
    _save(rows, P, name, {"model": model, "failed rows": failed, "cost usd": round(cost, 4)})


# ---------------------------------------------------------------------------------------------- chat models

CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"
CHAT_SYSTEM = ("You check quotations that a detection engine found in Arabic Islamic lecture transcripts (ASR output). "
               "Answer each question by choosing exactly one of its criteria labels.")


def sample(n=100, seed=20261026):
    """n of your test cards + n of Sonnet's from the same review lessons (same lectures and engines, only the labeller differs)."""
    import random
    rows = eval_laya.read_jsonl(TEST)
    rng = random.Random(seed)
    user = [r for r in rows if r["meta"]["source"] == "user"]
    sonnet = [r for r in rows if r["meta"]["source"].startswith("sonnet") and r["meta"]["group"] == "review"]
    return rng.sample(user, n) + rng.sample(sonnet, n)


def _ask_chat(row, key, model, tries=5):
    prompt = ("Answer the questions about this state. Reply with JSON {\"verdict\": label, \"boundary_status\": label}.\n"
              "QUESTIONS:\n" + json.dumps(row["questions"], ensure_ascii=False) +
              "\nSTATE:\n" + json.dumps(row["state"], ensure_ascii=False))
    body = {"model": model, "temperature": 0, "logprobs": True, "top_logprobs": 10, "usage": {"include": True},
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": CHAT_SYSTEM}, {"role": "user", "content": prompt}]}
    for attempt in range(tries):
        try:
            r = httpx.post(CHAT_URL, headers={"Authorization": f"Bearer {key}"}, json=body, timeout=90)
            d = r.json()
            c = d["choices"][0]
            ans = json.loads(c["message"]["content"])
            if ans.get("verdict") in eval_laya.VERDICTS:
                return {"answer": ans, "logprobs": (c.get("logprobs") or {}).get("content"), "usage": d.get("usage")}
            err = f"bad answer: {c['message']['content'][:200]}"
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as e:
            err = f"{type(e).__name__}: {e}"
        time.sleep(2 ** attempt)
    return {"error": err}


def _verdict_probs(reply):
    """P(verdict) from the logprobs of the first token of the verdict value; one-hot on the answer if not found."""
    import math
    ans = reply["answer"]["verdict"]
    toks = reply.get("logprobs") or []
    text, starts = "", []
    for t in toks:
        starts.append(len(text))
        text += t["token"]
    m = re.search(r'"verdict"\s*:\s*"', text)
    if m and m.end() in starts:
        probs = dict.fromkeys(eval_laya.VERDICTS, 0.0)
        for alt in toks[starts.index(m.end())]["top_logprobs"]:
            tok = alt["token"].strip().strip('"').upper()
            hits = [v for v in eval_laya.VERDICTS if tok and v.startswith(tok)]
            for v in hits:
                probs[v] += math.exp(alt["logprob"]) / len(hits)
        z = sum(probs.values())
        if z > 0 and max(probs, key=probs.get) == ans:
            return {k: v / z for k, v in probs.items()}
    return {v: float(v == ans) for v in eval_laya.VERDICTS}


def run_chat(model, name, n=100):
    rows, key = sample(n), _key()
    done = _run_api(name, rows, lambda r: _ask_chat(r, key, model))
    P = {}
    for k, v in done.items():
        if "error" in v:
            continue
        P[k] = {"verdict": _verdict_probs(v)}
        b = v["answer"].get("boundary_status")
        if b in eval_laya.BOUNDARIES:
            P[k]["boundary_status"] = {x: float(x == b) for x in eval_laya.BOUNDARIES}
    failed = [k for k, v in done.items() if "error" in v]
    cost = sum(float((v.get("usage") or {}).get("cost") or 0) for v in done.values())
    _save(rows, P, name, {"model": model, "failed rows": failed, "cost usd": round(cost, 4), "sample": [r["id"] for r in rows]})


def run_laya(model, name, device="cpu", batch_size=8):
    """Like eval_laya.predict, but each batch is appended to raw_<name>.jsonl, so an interrupted run resumes."""
    import laya
    rows = eval_laya.read_jsonl(TEST)
    raw_path = OUT / f"raw_{name.lower().replace(' ', '_')}.jsonl"
    OUT.mkdir(parents=True, exist_ok=True)
    P = {json.loads(l)["id"]: json.loads(l)["p"] for l in raw_path.open(encoding="utf-8")} if raw_path.exists() else {}
    todo = [r for r in rows if r["id"] not in P]
    print(f"{name}: {len(P)} cached, {len(todo)} to predict", flush=True)
    agent, questions, t0 = laya.load(model, device=device), rows[0]["questions"], time.time()
    with raw_path.open("a", encoding="utf-8") as f:
        for i in range(0, len(todo), batch_size):
            chunk = todo[i:i + batch_size]
            res = agent.predict_batch([r["state"] for r in chunk], questions, batch_size=batch_size, max_len=1024, head_max_len=256)
            for r, x in zip(chunk, res):
                a = x["answers"]
                P[r["id"]] = {q: {k: float(v) for k, v in a[q]["probabilities"].items()} for q in questions if q in a}
                f.write(json.dumps({"id": r["id"], "p": P[r["id"]]}) + "\n")
            f.flush()
            if (i // batch_size) % 20 == 0:
                print(f"  {i + len(chunk)}/{len(todo)} rows, {time.time() - t0:.0f}s", flush=True)
    _save(rows, P, name, {"model": model, "seconds": round(time.time() - t0)})


def _save(rows, P, name, extra):
    res = eval_laya.evaluate(rows, P, name)
    res.update(extra, predictions=P)
    path = OUT / (name.split(" (")[0].replace(" ", "_").lower() + ".json")
    path.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{name}: {len(P)}/{len(rows)} rows scored -> {path}")
    print(eval_laya.compare([res], "you"))


def report():
    res = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(OUT.glob("*.json"))]
    for g in ("you", "you + Sonnet", "Sonnet · other lectures", "written text"):
        print(f"\n### verdict · {g}\n" + eval_laya.compare(res, g))
    for g in ("you", "written text", "you + Sonnet"):
        print(f"\n### boundary · {g}\n" + eval_laya.compare_boundary(res, g))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=("jev", "laya", "chat", "report"))
    ap.add_argument("--model")
    ap.add_argument("--name")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--batch-size", type=int, default=8)
    a = ap.parse_args(argv)
    if a.cmd == "jev":
        run_jev(a.model or JEV_MODEL, a.name or "JEV")
    elif a.cmd == "chat":
        run_chat(a.model or "openai/gpt-4o-mini", a.name or "GPT-4o mini")
    elif a.cmd == "laya":
        run_laya(a.model, a.name or Path(a.model).name, a.device, a.batch_size)
    else:
        report()


if __name__ == "__main__":
    sys.exit(main())
