"""Review cards (ipywidgets): one item at a time, live score, Back / Skip / Undo, answers saved on every click.

Two answer modes:
  "choice"   one click = answer + next              (stage 1 GT check, stage 3 missed GT)
  "finding"  verdict + boundary, then Save & next   (stages 2 and 4; stage 2 is pre-filled with the automatic label)
"""
from __future__ import annotations

import html
import json
import subprocess
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from .cache import DATA_DIR, write_atomic
from .stages import BOUNDARY, SECTIONS_HELP, USEFUL, VERDICT, WITH_BOUNDARY, asr_tok_word

LABELS_DIR = DATA_DIR / "labels"
AUDIO_DIR = DATA_DIR / "cache" / "audio"
CTX_WORDS = 28
CORPUS_CTX = 30           # words of the original text shown around the matched part (long hadiths)

CSS = """
<style>
.wc{font-family:system-ui,sans-serif;max-width:980px;border:1px solid #8884;border-radius:10px;padding:12px 16px;margin:4px 0}
.wc .hdr{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:13px;margin-bottom:8px}
.wc .chip{padding:2px 8px;border-radius:12px;background:#8882;font-weight:600}
.wc .chip.q{background:#2e7d3233}.wc .chip.h{background:#1565c033}.wc .chip.a{background:#6a1b9a33}
.wc .sec{margin:8px 0;padding:8px 10px;border-radius:8px;background:#8881}
.wc .lbl{font-size:12px;opacity:.75;margin-bottom:4px}
.wc .ar{direction:rtl;font-size:20px;line-height:2.0;font-family:'Amiri','Noto Naskh Arabic',serif}
.wc .dim{opacity:.55}
.wc .mark{background:#ffd54f;color:#000;border-radius:4px;padding:0 2px}
.wc .gq{border-bottom:3px solid #43a047}
.wc .cm{background:#a5d6a7;color:#000;border-radius:4px;padding:0 2px}
.wc .auto{font-size:14px;margin-top:6px}
.wc .auto b{padding:2px 8px;border-radius:6px;background:#8883}
.wc .note{font-size:12px;opacity:.7}
.ws{font-family:system-ui,sans-serif;font-size:14px;padding:6px 10px;border-radius:8px;background:#8881;max-width:980px}
.ws b{font-size:15px}
</style>"""


def esc(s: str) -> str:
    return html.escape(str(s))


def words_html(words: List[str], lo: int, hi: int, classes: Dict[int, str]) -> str:
    """words[lo:hi], each word wrapped in its class (mark / gq / ...); outside text dimmed."""
    out, cur, buf = [], None, []

    def flush():
        if buf:
            t = esc(" ".join(buf))
            out.append(f"<span class='{cur}'>{t}</span>" if cur else t)

    for i in range(max(0, lo), min(len(words), hi)):
        c = classes.get(i, "")
        if c != cur:
            flush()
            buf, cur = [], c
        buf.append(words[i])
    flush()
    return " ".join(out)


def mmss(t: float) -> str:
    return f"{int(t // 60)}:{int(t % 60):02d}"


def audio_clip(doc_id: str, start: float, end: float) -> Optional[bytes]:
    src = AUDIO_DIR / f"{doc_id}.mp3"
    if not src.exists():
        return None
    s = max(0.0, start - 1.5)
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{s:.2f}", "-t", f"{end + 1.5 - s:.2f}", "-i", str(src),
                        "-ac", "1", "-b:a", "48k", "-f", "mp3", "pipe:1"], capture_output=True)
    return r.stdout or None


def _chip_src(kind: str) -> str:
    cls = {"QURAN": "q", "HADITH": "h"}.get(kind, "a")
    name = {"QURAN": "Quran", "HADITH": "Hadith", "ADHKAR": "Dhikr"}.get(kind, kind)
    return f"<span class='chip {cls}'>{name}</span>"


# ---------------------------------------------------------------------------------------------- card renderers
def render_finding(r: Dict[str, Any], b: Dict[str, Any], show_auto: bool = False, extra: str = "",
                   ctx: int = CTX_WORDS) -> Tuple[str, Optional[bytes]]:
    d, st, doc = r["det"], r["envelope"]["state"], b["doc"]
    ws, we = d["wordStartIdx"], d["wordEndIdx"]
    words = [w["word"] for w in b["asr_words"]]
    t0, t1 = b["asr_words"][ws]["start"], b["asr_words"][we]["end"]

    # ASR with the detected span highlighted
    asr = words_html(words, ws - ctx, we + 1 + ctx, {i: "mark" for i in range(ws, we + 1)})

    # written text: words aligned with the span (yellow) + any GT quote there (green underline)
    g = []
    if "gt" in doc:                      # YouTube lectures have no written text
        a2g, wt, tw = doc["asr2gt"], doc["word_tok"], doc["gt"]["tok_word"]
        g = [a2g[t] for t in range(wt[ws], wt[we + 1]) if a2g[t] >= 0]
    if g:
        gw0, gw1 = tw[min(g)], tw[max(g)]
        cls = {}
        for q in doc["gt"]["quran"] + doc["gt"]["hadith"]:
            if q["gt_start"] <= max(g) and q["gt_end"] > min(g) - 40:
                for t in range(q["gt_start"], q["gt_end"]):
                    cls[tw[t]] = "gq"
        for i in range(gw0, gw1 + 1):
            cls[i] = "mark"
        gt = words_html(doc["gt"]["words"], gw0 - ctx, gw1 + 1 + ctx, cls)
    else:
        gt = "<span class='note'>(this part of the speech could not be matched to the written text)</span>"

    # full original text with the matched part highlighted
    uw = d.get("unit_words") or []
    segs = d.get("qSegments") or []
    hl = {i: "cm" for a, z in segs for i in range(a, z)}
    if uw:
        lo = max(0, (segs[0][0] if segs else 0) - CORPUS_CTX)
        hi = min(len(uw), (segs[-1][1] if segs else len(uw)) + CORPUS_CTX)
        corpus = ("… " if lo > 0 else "") + words_html(uw, lo, hi, hl) + (" …" if hi < len(uw) else "")
    else:
        corpus = esc(st.get("canonical_corpus_text", ""))

    hdr = (f"{_chip_src(d['sourceType'])}<span class='chip'>{esc(d.get('displayRef', ''))}</span>"
           f"<span class='chip'>{esc(d.get('confidenceBand', ''))}</span>"
           f"<span>{esc(doc['title'][:60])}</span><span class='dim'>· {mmss(t0)} · {we - ws + 1} words</span>")
    auto = ""
    if show_auto:
        v, bd = r["label"]["verdict"], r["label"]["boundary"]
        auto = (f"<div class='auto'>Automatic label: <b>{esc(VERDICT.get(v, '—'))}</b>"
                + (f" · <b>{esc(BOUNDARY.get(bd, ''))}</b>" if v == "CORRECT" and bd else "") + "</div>")
    written = (f"<div class='sec'><div class='lbl'>{SECTIONS_HELP['gt']} <span class='gq'>green underline = quote marked in the text</span></div><div class='ar'>{gt}</div></div>"
               if "gt" in doc else "")
    body = (f"<div class='wc'><div class='hdr'>{hdr}</div>"
            f"<div class='sec'><div class='lbl'>{SECTIONS_HELP['asr']}</div><div class='ar'>{asr}</div></div>"
            f"{written}"
            f"<div class='sec'><div class='lbl'>{SECTIONS_HELP['corpus']}</div><div class='ar'>{corpus}</div></div>"
            f"{auto}{extra}</div>")
    return CSS + body, audio_clip(doc["doc_id"], t0, t1)


def render_gt(it: Dict[str, Any], b: Dict[str, Any], with_asr: bool = False, engine: str = "") -> Tuple[str, Optional[bytes]]:
    doc = b["doc"]
    tw = doc["gt"]["tok_word"]
    gw0, gw1 = tw[it["gt_start"]], tw[it["gt_end"] - 1]
    gt = words_html(doc["gt"]["words"], gw0 - CTX_WORDS, gw1 + 1 + CTX_WORDS, {i: "mark" for i in range(gw0, gw1 + 1)})
    secs = f"<div class='sec'><div class='lbl'>Bin Baz written text — the extracted quote is highlighted</div><div class='ar'>{gt}</div></div>"
    if it["kind"] == "QURAN" and it.get("unit_words"):
        uw = it["unit_words"]
        corpus = words_html(uw, 0, len(uw), {i: "cm" for i in range(it["u_start"], it["u_end"])})
        secs += f"<div class='sec'><div class='lbl'>The verse it was matched to — the part said is highlighted</div><div class='ar'>{corpus}</div></div>"
    clip = None
    if with_asr and it["asr_ws"] is not None:
        words = [w["word"] for w in b["asr_words"]]
        asr = words_html(words, it["asr_ws"] - CTX_WORDS, it["asr_we"] + 1 + CTX_WORDS,
                         {i: "mark" for i in range(it["asr_ws"], it["asr_we"] + 1)})
        secs += f"<div class='sec'><div class='lbl'>{SECTIONS_HELP['asr']} — where this quote was said</div><div class='ar'>{asr}</div></div>"
        clip = audio_clip(doc["doc_id"], b["asr_words"][it["asr_ws"]]["start"], b["asr_words"][it["asr_we"]]["end"])
    ref = it.get("ref") or ("hadith (book text)" if it["kind"] == "HADITH" else "")
    other = ""
    if with_asr:
        others = [e for e in it.get("caught_by", []) if e != engine]
        other = f"<span class='chip'>{'caught by ' + ', '.join(others) if others else 'no engine caught it'}</span>"
    hdr = (f"{_chip_src(it['kind'])}<span class='chip'>{esc(ref)}</span>{other}"
           f"<span>{esc(doc['title'][:60])}</span><span class='dim'>· {it['n_tokens']} words</span>")
    return CSS + f"<div class='wc'><div class='hdr'>{hdr}</div>{secs}</div>", clip


# ---------------------------------------------------------------------------------------------- answer store
_STORES: Dict[str, Dict[str, Any]] = {}


def store(name: str) -> Dict[str, Any]:
    """One shared dict per label file: stages 2 and 4 both write `findings`, so two open widgets must not hold
    separate copies (the last one to save would erase the other's clicks)."""
    if name not in _STORES:
        p = LABELS_DIR / f"{name}.json"
        _STORES[name] = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    return _STORES[name]


_UNDONE: Dict[str, set] = {}


def save_store(name: str) -> None:
    """Merge with what is on disk before writing: answers written elsewhere (another kernel, a script) are kept, the
    newest answer per card wins, and a card undone in this session stays undone."""
    p = LABELS_DIR / f"{name}.json"
    mem, undone = _STORES[name], _UNDONE.setdefault(name, set())
    if p.exists():
        for k, v in json.loads(p.read_text(encoding="utf-8")).items():
            if k in undone and (k not in mem):
                continue
            if k not in mem or v.get("t", 0) > mem[k].get("t", 0):
                mem[k] = v
    write_atomic(p, json.dumps(mem, ensure_ascii=False, indent=0).encode("utf-8"))


# ---------------------------------------------------------------------------------------------- the reviewer
class Reviewer:
    def __init__(self, items: List[Any], name: str, render: Callable[[Any], Tuple[str, Optional[bytes]]],
                 key: Callable[[Any], str], summary: Callable[[List[Any], Dict[str, Any]], Dict[str, Any]],
                 mode: str = "choice", choices: Optional[Dict[str, str]] = None,
                 prefill: Optional[Callable[[Any], Tuple[Optional[str], Optional[str]]]] = None):
        import ipywidgets as w
        self.w, self.items, self.render, self.key, self.summary = w, items, render, key, summary
        self.mode, self.choices, self.prefill = mode, choices or {}, prefill
        self.name = name
        self.ans = store(name)
        self.history: List[Tuple[int, str, Any]] = []
        self.pos = next((i for i, it in enumerate(items) if key(it) not in self.ans), len(items))

        self.score, self.card, self.saved = w.HTML(), w.HTML(), w.HTML()
        self.audio = w.Audio(format="mp3", autoplay=False, loop=False, layout=w.Layout(width="420px"))
        self.back = w.Button(description="◀ Back", layout=w.Layout(width="90px"))
        self.skip = w.Button(description="Skip ▶", layout=w.Layout(width="90px"))
        self.undo = w.Button(description="↶ Undo", button_style="warning", layout=w.Layout(width="90px"))
        self.back.on_click(lambda _: self.go(self.pos - 1))
        self.skip.on_click(lambda _: self.go(self.pos + 1))
        self.undo.on_click(lambda _: self.do_undo())
        nav = w.HBox([self.back, self.skip, self.undo])

        if mode == "choice":
            btns = []
            for v, label in self.choices.items():
                style = "success" if label.startswith("✔") else "danger" if label.startswith("✘") else ""
                bt = w.Button(description=label, button_style=style, layout=w.Layout(width="auto", min_width="150px"))
                bt.on_click(lambda _, v=v: self.answer(v))
                btns.append(bt)
            controls = w.HBox(btns, layout=w.Layout(flex_flow="row wrap"))
        else:
            self.v = w.ToggleButtons(options=[(lab, k) for k, lab in VERDICT.items()], value=None, description="Verdict",
                                     style={"button_width": "160px"})
            self.b = w.ToggleButtons(options=[(lab, k) for k, lab in BOUNDARY.items()], value=None, description="Boundary",
                                     style={"button_width": "130px"})
            # a cut caused by garbled speech: Laya still learns the boundary, engine statistics don't blame the engine
            self.nf = w.ToggleButton(value=False, description="Not the engine's fault (ASR garbled it)", icon="microphone-slash",
                                     layout=w.Layout(width="320px", margin="0 0 0 92px"))
            # real quote, but the shown verse / hadith is not the best match (other ayah, other riwaya, or the quote goes on
            # past what this reference contains). Boundary stays relative to the SHOWN reference: that is all Laya can see.
            self.rf = w.ToggleButton(value=False, description="Reference wrong / incomplete", icon="book",
                                     layout=w.Layout(width="320px", margin="0 0 0 92px"))
            # the sheikh inserted his own words inside the quote (explanation in the middle): still a real quote
            self.ins = w.ToggleButton(value=False, description="Sheikh's words inside the quote", icon="comment",
                                      layout=w.Layout(width="320px", margin="0 0 0 92px"))
            self.ok = w.Button(description="Save & next ▶", button_style="success", layout=w.Layout(width="180px"))
            self.v.observe(lambda _: self._sync(), "value")
            self.b.observe(lambda _: self._sync(), "value")
            self.ok.on_click(lambda _: self.answer(self._finding_answer()))
            controls = w.VBox([self.v, self.b, w.HBox([self.nf, self.rf]), self.ins, self.ok])
        self.box = w.VBox([self.score, self.card, self.audio, self.saved, controls, nav])
        self.show()

    # -- state
    def _save(self) -> None:
        save_store(self.name)

    def _sync(self) -> None:
        if self.mode != "finding":
            return
        need_b = self.v.value in WITH_BOUNDARY
        self.b.disabled = not need_b
        cut = need_b and (self.b.value or "").startswith("MISSING")
        self.nf.disabled = not cut
        if not cut:
            self.nf.value = False
        self.ins.disabled = not need_b
        if not need_b:
            self.ins.value = False
        useful = self.v.value in USEFUL
        self.rf.disabled = not useful
        if not useful:
            self.rf.value = False
        self.ok.disabled = self.v.value is None or (need_b and self.b.value is None)

    def answer(self, value: Any) -> None:
        if self.pos >= len(self.items):
            return
        k = self.key(self.items[self.pos])
        self.history.append((self.pos, k, self.ans.get(k)))
        self.ans[k] = {"answer": value, "t": time.time()}
        _UNDONE.setdefault(self.name, set()).discard(k)
        self._save()
        self.go(self.pos + 1)

    def do_undo(self) -> None:
        if not self.history:
            return
        pos, k, prev = self.history.pop()
        if prev is None:
            self.ans.pop(k, None)
            _UNDONE.setdefault(self.name, set()).add(k)
        else:
            self.ans[k] = prev
        self._save()
        self.go(pos)

    def go(self, pos: int) -> None:
        self.pos = max(0, min(len(self.items), pos))
        self.show()

    # -- display
    def _finding_answer(self) -> Dict[str, Any]:
        b = self.b.value if self.v.value in WITH_BOUNDARY else None
        return {"verdict": self.v.value, "boundary": b,
                "not_engine_fault": bool(self.nf.value and b and b.startswith("MISSING")),
                "ref_issue": bool(self.rf.value and self.v.value in USEFUL),
                "has_insertion": bool(self.ins.value and b)}

    def _fmt_saved(self, a: Any) -> str:
        if isinstance(a, dict):
            return (VERDICT.get(a["verdict"], "") + (f" · {BOUNDARY[a['boundary']]}" if a.get("boundary") else "")
                    + (" · not the engine's fault" if a.get("not_engine_fault") else "")
                    + (" · reference wrong / incomplete" if a.get("ref_issue") else "")
                    + (" · sheikh's words inside" if a.get("has_insertion") else ""))
        return self.choices.get(a, str(a))

    def show(self) -> None:
        s = self.summary(self.items, self.ans)
        parts = " · ".join(f"{esc(k)}: <b>{esc(v)}</b>" for k, v in s.items())
        self.score.value = f"{CSS}<div class='ws'>Card <b>{min(self.pos + 1, len(self.items))}/{len(self.items)}</b> · {parts}</div>"
        self.back.disabled = self.pos == 0
        self.undo.disabled = not self.history
        if self.pos >= len(self.items):
            self.card.value = "<h3>All cards done 🎉</h3>"
            self.audio.value = b""
            self.saved.value = ""
            return
        it = self.items[self.pos]
        body, clip = self.render(it)
        self.card.value = body
        self.audio.value = clip or b""
        self.audio.layout.display = "" if clip else "none"
        prev = self.ans.get(self.key(it))
        self.saved.value = (f"<div class='ws'>Your saved answer: <b>{esc(self._fmt_saved(prev['answer']))}</b> "
                            f"(answering again replaces it)</div>" if prev else "")
        if self.mode == "finding":
            if prev:
                self.v.value, self.b.value = prev["answer"]["verdict"], prev["answer"].get("boundary")
                self.nf.value = bool(prev["answer"].get("not_engine_fault"))
                self.rf.value = bool(prev["answer"].get("ref_issue"))
                self.ins.value = bool(prev["answer"].get("has_insertion"))
            elif self.prefill:
                v, bd = self.prefill(it)
                self.v.value = v
                self.b.value = bd if v == "CORRECT" else None
                self.nf.value = self.rf.value = self.ins.value = False
            else:
                self.v.value, self.b.value = None, None
                self.nf.value = self.rf.value = self.ins.value = False
            self._sync()

    def _ipython_display_(self) -> None:
        from IPython.display import display
        display(self.box)


def load_answers(name: str) -> Dict[str, Any]:
    return store(name)
