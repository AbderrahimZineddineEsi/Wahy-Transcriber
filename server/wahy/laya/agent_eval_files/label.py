"""Labelling tool for the blind test (standard library only).

  python3 label.py next                                         show the next unanswered card
  python3 label.py answer <card> <VERDICT> [<BOUNDARY>] "<reason>"
  python3 label.py status                                       progress and time so far

VERDICT  = CORRECT | IN_HADITH | PARAPHRASE | FALSE | NOT_SURE
BOUNDARY = COMPLETE_SPAN | MISSING_START | MISSING_END | MISSING_BOTH   (only with CORRECT / IN_HADITH)
"""
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CARDS = json.loads((HERE / "cards.json").read_text(encoding="utf-8"))
ANS = HERE / "answers.json"
VERDICTS = ("CORRECT", "IN_HADITH", "PARAPHRASE", "FALSE", "NOT_SURE")
WITH_BOUNDARY = ("CORRECT", "IN_HADITH")
BOUNDARIES = ("COMPLETE_SPAN", "MISSING_START", "MISSING_END", "MISSING_BOTH")


def load():
    return json.loads(ANS.read_text(encoding="utf-8")) if ANS.exists() else {}


def save(a):
    tmp = ANS.with_suffix(".tmp")
    tmp.write_text(json.dumps(a, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(ANS)


def answered(a):
    return sum("verdict" in v for v in a.values())


def show_next():
    a = load()
    for c in CARDS:
        if "verdict" not in a.get(c["id"], {}):
            a.setdefault(c["id"], {}).setdefault("t_shown", time.time())
            save(a)
            print(c["text"])
            print(f"({answered(a)}/{len(CARDS)} answered)")
            return
    print(f"All {len(CARDS)} cards answered.")


def answer(args):
    if len(args) < 3:
        sys.exit('usage: python3 label.py answer <card> <VERDICT> [<BOUNDARY>] "<reason>"')
    cid, v, rest = args[0], args[1].upper(), args[2:]
    a = load()
    if cid not in {c["id"] for c in CARDS}:
        sys.exit(f"unknown card {cid}")
    if "t_shown" not in a.get(cid, {}):
        sys.exit(f"{cid} has not been shown yet: run `python3 label.py next` first")
    if v not in VERDICTS:
        sys.exit(f"verdict must be one of {', '.join(VERDICTS)}")
    b = None
    if v in WITH_BOUNDARY:
        b = rest[0].upper()
        if b not in BOUNDARIES:
            sys.exit(f"{v} needs a boundary: one of {', '.join(BOUNDARIES)}")
        rest = rest[1:]
    reason = " ".join(rest).strip()
    if not reason:
        sys.exit("give a short reason")
    a[cid].update(verdict=v, boundary=b, reason=reason, t_answered=time.time())
    save(a)
    print(f"saved {cid}: {v}{' · ' + b if b else ''}  ({answered(a)}/{len(CARDS)} answered)")


def status():
    a = load()
    ts = [t for v in a.values() for t in (v.get("t_shown"), v.get("t_answered")) if t]
    mins = (max(ts) - min(ts)) / 60 if ts else 0
    print(f"{answered(a)}/{len(CARDS)} answered · {mins:.1f} min so far")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "next":
        show_next()
    elif cmd == "answer":
        answer(sys.argv[2:])
    elif cmd == "status":
        status()
    else:
        print(__doc__)
