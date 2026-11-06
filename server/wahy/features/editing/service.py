"""Editing: every change the editor makes to a lecture, each one an operation in the lecture's log, so undo
works
and survives a reload (ROADMAP phase 16; F-003, F-041, F-053, F-056, F-058 to F-064, F-067, F-068).

    edits = EditingService(db, engine, lectures, detection, verification)
    edits.add_quote(lecture_id, AddQuote(start=40, end=47, unit_id="2:255"))
    edits.replace_text(lecture_id, corrected_text)     # unchanged words keep their times
    edits.undo(lecture_id)                             # the newest edit, whatever it was

How it works (the command pattern). Each public method builds a `Change` from the lecture as it is now (the
words,
the live findings, the caption edits): which words are replaced, which findings change, are added or removed,
the new
caption edits, and the verdicts it saves. `_apply` writes the change and, in the same transaction, an
`EditOp` row
whose `undo` holds what the change replaced. `undo()` takes the newest op that is not undone and writes that
back.
Undo is newest-first only, which keeps it simple and always correct: every change to the words and findings
goes
through here, except a new detection, which starts the log again (detection/service.py).

The finding edits themselves (how a finding looks after "move the start one word left") run in the engine
(engine/src/edit.ts), because they need the corpus and the canonical re-alignment. A deleted finding is only
marked
deleted, so undo brings it back with its verdicts and gold label.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import delete, func, insert, select, update

from wahy.core.db import Database, utcnow
from wahy.core.engine import EngineClient, EngineError
from wahy.features.detection.models import Finding
from wahy.features.detection.service import DetectionService
from wahy.features.editing.align import ONLY_MARKS_RE, TOKEN_RE, Shift, replace_span
from wahy.features.editing.models import CaptionEdits, EditOp
from wahy.features.editing.schemas import (
    AddQuote,
    CaptionEdit,
    DeleteIntent,
    DismissMerge,
    EditDone,
    FindingEdit,
    Merge,
    OpOut,
    ReplaceText,
    ReplaceWords,
    Undone,
)
from wahy.features.lectures.models import Lecture, Word
from wahy.features.lectures.parsing import TimedWord
from wahy.features.lectures.schemas import WordOut
from wahy.features.lectures.service import BadLectureInput, LectureService, WordNotFound
from wahy.features.training.models import Label
from wahy.features.verification.models import Verdict
from wahy.features.verification.schemas import Expanded, ExpandIn, VerdictIn
from wahy.features.verification.service import FindingNotFound, VerificationService, to_model_boundary

RESCAN_MARGIN = 3  # words around an edited span that a re-scan may find new quotes in (as the old editor)


class EditError(Exception):
    """The edit can't be made (the API answers 409)."""


class NothingChanged(EditError):
    """The edit would change nothing (the API answers 409; nothing is logged)."""


class NothingToUndo(EditError):
    pass


class BadEdit(EditError, ValueError):
    """The edit's input is unusable (the API answers 422)."""


@dataclass
class Row:
    """A live finding as the editor sees it."""

    id: int
    idx: int
    engine: str
    data: dict[str, Any]

    @property
    def start(self) -> int:
        return int(self.data.get("wordStartIdx", 0))

    @property
    def end(self) -> int:
        return int(self.data.get("wordEndIdx", 0))


@dataclass
class State:
    lecture_id: int
    words: list[TimedWord]
    findings: list[Row]  # live ones, in word order
    caption_edits: list[dict[str, Any]]
    engine: str  # the lecture's engine choice (its findings', else the saved setting)

    def finding(self, finding_id: int) -> Row:
        for f in self.findings:
            if f.id == finding_id:
                return f
        raise FindingNotFound(f"no finding {finding_id} in lecture {self.lecture_id}")

    def word_dicts(self, words: list[TimedWord] | None = None) -> list[dict[str, Any]]:
        return [
            {"word": w.text, "start": w.start, "end": w.end}
            for w in (words if words is not None else self.words)
        ]


@dataclass
class Change:
    words: tuple[int, int, list[TimedWord]] | None = None  # replace words[a:b] with these
    update: dict[int, dict[str, Any]] = field(default_factory=dict)  # finding id → its new data
    add: list[dict[str, Any]] = field(default_factory=list)  # new findings' data
    remove: list[int] = field(default_factory=list)
    captions: list[dict[str, Any]] | None = None
    verdicts: list[dict[str, Any]] = field(default_factory=list)  # Verdict columns, to add
    # verdicts and labels another service saved for this edit: (verdict id, label id, the label before or
    # None)
    saved: list[tuple[int, int, dict[str, Any] | None]] = field(default_factory=list)
    finding_id: int | None = None

    def empty(self) -> bool:
        return not (
            self.words
            or self.update
            or self.add
            or self.remove
            or self.captions is not None
            or self.verdicts
            or self.saved
        )


def _finding_columns(data: dict[str, Any]) -> dict[str, Any]:
    return dict(
        source_type=str(data.get("sourceType")),
        unit_id=data.get("unitId"),
        display_ref=data.get("displayRef"),
        word_start=int(data.get("wordStartIdx", 0)),
        word_end=int(data.get("wordEndIdx", 0)),
        data=data,
    )


def retime_finding(data: dict[str, Any], words: list[TimedWord]) -> dict[str, Any]:
    """A finding's times and matched text read from its words, its characters from the engine's tokens (the
    same
    as edit.ts does after its own edits)."""
    d = dict(data)
    a, b = d.get("wordStartIdx"), d.get("wordEndIdx")
    if not (isinstance(a, int) and isinstance(b, int) and 0 <= a <= b < len(words)):
        return d
    d["startTime"], d["endTime"] = words[a].start, words[b].end
    d["matchedText"] = " ".join(w.text.strip() for w in words[a : b + 1])
    t0, t1 = d.get("tStart"), d.get("tEnd")
    if isinstance(t0, int) and isinstance(t1, int):
        text = " ".join(w.text.strip() for w in words)
        spans = [(m.start(), m.end()) for m in TOKEN_RE.finditer(text) if not ONLY_MARKS_RE.match(m.group(0))]
        if 0 <= t0 < len(spans) and 0 < t1 <= len(spans):
            d["charStart"] = d["startIndex"] = spans[t0][0]
            d["charEnd"] = d["endIndex"] = spans[t1 - 1][1]
    return d


class EditingService:
    def __init__(
        self,
        db: Database,
        engine: EngineClient,
        lectures: LectureService,
        detection: DetectionService,
        verification: VerificationService,
    ):
        self.db, self.engine, self.lectures = db, engine, lectures
        self.detection, self.verification = detection, verification
        self._locks: dict[int, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    # ---- the log
    # -------------------------------------------------------------------------------------------------

    def log(self, lecture_id: int) -> list[OpOut]:
        """The lecture's edits, newest first."""
        self.lectures.list_one(lecture_id)
        with self.db.session() as s:
            rows = s.scalars(select(EditOp).where(EditOp.lecture_id == lecture_id).order_by(EditOp.id.desc()))
            return [self._op_out(r) for r in rows]

    def undo(self, lecture_id: int) -> Undone:
        """Undo the newest edit that is not undone yet (F-003)."""
        self.lectures.list_one(lecture_id)
        with self._lock(lecture_id), self.db.session() as s:
            op = s.scalars(
                select(EditOp)
                .where(EditOp.lecture_id == lecture_id, EditOp.undone_at.is_(None))
                .order_by(EditOp.id.desc())
                .limit(1)
            ).first()
            if op is None:
                raise NothingToUndo("nothing to undo")
            u = op.undo
            if "words" in u:
                w = u["words"]
                old = [TimedWord(x["word"], x["start"], x["end"]) for x in w["old"]]
                self._write_words(s, lecture_id, w["start"], w["start"] + w["count"], old)
            for f in u.get("findings", []):
                s.execute(update(Finding).where(Finding.id == f["id"]).values(**f["before"]))
            if u.get("added"):
                s.execute(update(Finding).where(Finding.id.in_(u["added"])).values(deleted=True))
            if "captions" in u:
                self._write_captions(s, lecture_id, u["captions"])
            if u.get("verdicts"):
                s.execute(delete(Verdict).where(Verdict.id.in_(u["verdicts"])))
            for lab in u.get("labels", []):
                if lab["before"] is None:
                    s.execute(delete(Label).where(Label.id == lab["id"]))
                else:
                    s.execute(update(Label).where(Label.id == lab["id"]).values(**lab["before"]))
            op.undone_at = utcnow()
            s.get(Lecture, lecture_id).updated_at = utcnow()  # type: ignore[union-attr]
            s.flush()
            return Undone(op=self._op_out(op))

    @staticmethod
    def clear(s: Any, lecture_id: int) -> None:
        """Start the log and the caption edits again (a new detection replaced the findings they point at)."""
        s.execute(delete(EditOp).where(EditOp.lecture_id == lecture_id))
        s.execute(delete(CaptionEdits).where(CaptionEdits.lecture_id == lecture_id))

    # ---- words
    # ---------------------------------------------------------------------------------------------------

    def edit_word(self, lecture_id: int, idx: int, text: str) -> WordOut:
        """Correct one word in place (F-041); its time stays. The findings stay too (no re-scan)."""
        text = text.strip()
        if not text or len(text.split()) != 1:
            raise BadLectureInput("give exactly one word (use the text editor to add or remove words)")
        state = self._state(lecture_id)
        if not 0 <= idx < len(state.words):
            raise WordNotFound(idx)
        self._replace(
            state,
            idx,
            idx,
            [text],
            kind="edit_word",
            label="Edit a word",
            rescan=False,
            params={"idx": idx, "text": text},
        )
        w = self._state(lecture_id).words[idx]
        return WordOut(idx=idx, text=w.text, start=w.start, end=w.end)

    def replace_words(self, lecture_id: int, body: ReplaceWords) -> EditDone:
        """Rewrite some words (F-056). Words that stay keep their times; quotes around the span keep theirs;
        quotes
        that only partly overlapped a span whose length changed are removed, and the span is scanned again."""
        state = self._state(lecture_id)
        n = len(state.words)
        if body.start > n or body.end >= n or body.end < body.start - 1:
            raise BadEdit(f"words {body.start}..{body.end} are not in the lecture (0..{n - 1})")
        return self._replace(
            state,
            body.start,
            body.end,
            body.text.split(),
            kind="replace_words",
            label="Edit words",
            params=body.model_dump(),
        )

    def replace_text(self, lecture_id: int, body: ReplaceText) -> EditDone:
        """The full-text editor (F-067): only the changed middle is re-timed, so every other word keeps its
        time."""
        state = self._state(lecture_id)
        old = [w.text for w in state.words]
        new = body.text.split()
        pre = 0
        while pre < len(old) and pre < len(new) and old[pre] == new[pre]:
            pre += 1
        suf = 0
        while suf < len(old) - pre and suf < len(new) - pre and old[-1 - suf] == new[-1 - suf]:
            suf += 1
        return self._replace(
            state,
            pre,
            len(old) - 1 - suf,
            new[pre : len(new) - suf],
            kind="replace_text",
            label="Edit the lecture text",
            params={"start": pre, "end": len(old) - 1 - suf, "words": len(new) - pre - suf},
        )

    def _replace(
        self,
        state: State,
        start: int,
        end: int,
        new_texts: list[str],
        *,
        kind: str,
        label: str,
        params: dict[str, Any],
        rescan: bool = True,
    ) -> EditDone:
        def build(st: State) -> Change:
            words = st.words
            if [w.text for w in words[start : end + 1]] == new_texts:
                raise NothingChanged("the text is the same")
            new = replace_span(words, start, end, new_texts)
            shift = Shift.of([w.text for w in words], start, end, new_texts)
            after = words[:start] + new + words[end + 1 :]
            ch = Change(words=(start, end + 1, new))
            moved = shift.delta or shift.tok_new != shift.tok_old or shift.char_delta
            kept: list[tuple[int, int]] = []
            for f in st.findings:
                if f.end < start:
                    kept.append((f.start, f.end))
                    continue
                if f.start > end:
                    if moved:
                        ch.update[f.id] = shift.finding(f.data)
                    kept.append((shift.word(f.start), shift.word(f.end)))
                    continue
                around = f.start < start and end < f.end  # the edit is inside the quote
                if around or (shift.delta == 0 and new_texts):
                    d = retime_finding(shift.finding(f.data), after)
                    ch.update[f.id] = d
                    kept.append((d["wordStartIdx"], d["wordEndIdx"]))
                else:
                    ch.remove.append(f.id)
            if rescan and new:
                lo, hi = (
                    max(0, start - RESCAN_MARGIN),
                    min(len(after) - 1, start + len(new) - 1 + RESCAN_MARGIN),
                )
                for d in self.engine.detect(st.word_dicts(after), self._options(st)):
                    a, b = int(d.get("wordStartIdx", -1)), int(d.get("wordEndIdx", -1))
                    if b < lo or a > hi or any(a <= y and x <= b for x, y in kept):
                        continue
                    ch.add.append(d)
                    kept.append((a, b))
            edits = []
            for e in st.caption_edits:
                w = shift.word_after(int(e["word"]))
                if w >= 0:
                    edits.append({**e, "word": w})
            if edits != st.caption_edits:
                ch.captions = edits
            return ch

        return self._apply(state.lecture_id, kind, label, params, build, state=state)

    # ---- findings
    # ------------------------------------------------------------------------------------------------

    def add_quote(self, lecture_id: int, body: AddQuote) -> EditDone:
        """Insert a missed quote (F-053). Findings that overlap its words are removed, as in the old
        editor."""

        def build(st: State) -> Change:
            if body.end < body.start:
                raise BadEdit("the quote ends before it starts")
            req = {
                "op": "add_quote",
                "start": body.start,
                "end": body.end,
                "unitId": body.unit_id or None,
                "sourceType": body.source_type,
                "ref": body.ref,
                "qiraah": body.qiraah,
            }
            data = self._engine_edit(st, req)["finding"]
            ch = Change(add=[data])
            ch.remove = [f.id for f in st.findings if not (f.end < body.start or f.start > body.end)]
            return ch

        return self._apply(lecture_id, "add_quote", "Add a missed quote", body.model_dump(), build)

    def edit_finding(self, finding_id: int, body: FindingEdit) -> EditDone:
        """One change to a finding (F-058, F-059, F-061, F-062, F-063)."""
        lecture_id = self._lecture_of(finding_id)
        labels = {
            "move_edge": "Move the quote's edge",
            "set_kind": "Change the quote's kind",
            "snap": "Switch to the source text",
            "canonical_words": "Use the reference's words",
            "link_reference": "Link another reference",
            "add_candidate": "Add a matching reference",
            "remove_candidate": "Remove a matching reference",
            "merge": "Merge with the neighbour",
            "dismiss_merge": "Dismiss the merge suggestion",
        }

        def build(st: State) -> Change:
            f = st.finding(finding_id)
            if isinstance(body, Merge):
                return self._merge(st, f, body)
            if isinstance(body, DismissMerge):
                data = dict(f.data)
                data["mergeDismissed"] = sorted({*data.get("mergeDismissed", []), body.direction})
                return Change(update={f.id: data}, finding_id=f.id)
            req: dict[str, Any] = {"op": body.op, "finding": f.data}
            extra = body.model_dump(exclude={"op"})
            if "unit_id" in extra:
                extra["unitId"] = extra.pop("unit_id")
            req.update(extra)
            data = self._engine_edit(st, req)["finding"]
            if data == f.data:
                raise NothingChanged("the finding is already like that")
            return Change(update={f.id: data}, finding_id=f.id)

        return self._apply(
            lecture_id, body.op, labels[body.op], {"finding_id": finding_id, **body.model_dump()}, build
        )

    def _merge(self, st: State, f: Row, body: Merge) -> Change:
        k = st.findings.index(f)
        other_k = k - 1 if body.direction == "previous" else k + 1
        if not 0 <= other_k < len(st.findings):
            raise EditError(f"there is no {body.direction} finding to merge with")
        other = st.findings[other_k]
        first, second = (other, f) if body.direction == "previous" else (f, other)
        out = self._engine_edit(
            st, {"op": "merge", "first": first.data, "second": second.data, "gapType": body.gap_type}
        )
        keep, gone = (first, second) if out.get("kept", "first") == "first" else (second, first)
        return Change(update={keep.id: out["finding"]}, remove=[gone.id], finding_id=keep.id)

    def delete_finding(self, finding_id: int, intent: DeleteIntent) -> EditDone:
        """Delete a finding, saying why (F-064): "ordinary_speech" also saves a gold label "false" (training
        truth);
        "highlight_mistake" and "testing" save nothing. Undo brings the finding back and removes the label."""
        lecture_id = self._lecture_of(finding_id)

        def build(st: State) -> Change:
            f = st.finding(finding_id)
            ch = Change(remove=[f.id], finding_id=f.id)
            if intent == "ordinary_speech":
                with self.db.session() as s:
                    lab = s.scalar(select(Label).where(Label.finding_id == f.id, Label.source == "user"))
                    before = (
                        None
                        if lab is None
                        else {"verdict": lab.verdict, "boundary": lab.boundary, "card": lab.card}
                    )
                saved = self.verification.set_verdict(f.id, VerdictIn(verdict="FALSE"))
                ch.saved.append((saved.verdict_id, saved.label_id, before))
            return ch

        return self._apply(
            lecture_id, "delete", "Delete a finding", {"finding_id": finding_id, "intent": intent}, build
        )

    def expand(self, finding_id: int, body: ExpandIn) -> Expanded:
        """Grow a finding over the words its start or end is missing (F-060, the old editor's auto-heal). Its
        newest
        verdict is kept with a complete boundary, as the user's. Undo shrinks it back and removes that
        verdict."""
        lecture_id = self._lecture_of(finding_id)
        result: dict[str, Any] = {}

        def build(st: State) -> Change:
            f = st.finding(finding_id)
            with self.db.session() as s:
                prev = s.scalars(
                    select(Verdict).where(Verdict.finding_id == f.id).order_by(Verdict.id.desc()).limit(1)
                ).first()
                if prev is not None:
                    s.expunge(prev)
            boundary = body.boundary or to_model_boundary(prev.boundary if prev else None) or "MISSING_BOTH"
            out = self.engine.expand(f.data, st.word_dicts(), boundary, self._options(st))
            result.update(out)
            if not out["changed"]:
                raise NothingChanged(out.get("reason") or "no_match")
            new = out["finding"]
            ch = Change(update={f.id: new}, finding_id=f.id)
            if prev is not None:
                ch.verdicts.append(
                    dict(
                        finding_id=f.id,
                        verifier="human",
                        model=None,
                        verdict=prev.verdict,
                        boundary="COMPLETE",
                        confidence=prev.confidence,
                        reason=prev.reason,
                        details={
                            **(prev.details or {}),
                            "based_on": prev.id,
                            "user_action": "EXPAND",
                            "expanded": {
                                "from": [f.start, f.end],
                                "to": [int(new["wordStartIdx"]), int(new["wordEndIdx"])],
                                "boundary": boundary,
                            },
                        },
                    )
                )
            return ch

        try:
            self._apply(
                lecture_id,
                "expand",
                "Expand the quote",
                {"finding_id": finding_id, **body.model_dump()},
                build,
            )
        except NothingChanged:
            if not result:
                raise
        new = result["finding"]
        return Expanded(
            finding_id=finding_id,
            changed=bool(result["changed"]),
            reason=result.get("reason"),
            added=result["added"],
            word_start=int(new["wordStartIdx"]),
            word_end=int(new["wordEndIdx"]),
            data=new,
        )

    # ---- captions
    # ------------------------------------------------------------------------------------------------

    def caption_edits(self, lecture_id: int) -> list[dict[str, Any]]:
        with self.db.session() as s:
            row = s.get(CaptionEdits, lecture_id)
            return list(row.edits) if row else []

    def edit_caption(self, lecture_id: int, body: CaptionEdit) -> EditDone:
        """One edit of the caption timing editor (F-068). A quote is a locked unit: splitting it, or merging
        it with
        speech, is refused."""
        labels = {
            "split": "Split a caption",
            "merge": "Merge two captions",
            "time": "Change a caption's time",
        }

        def build(st: State) -> Change:
            edit: dict[str, Any] = {"op": body.op, "word": body.word}
            if body.op == "time":
                if body.start is None and body.end is None:
                    raise BadEdit("give a start or an end")
                edit.update({k: v for k, v in (("start", body.start), ("end", body.end)) if v is not None})
            caps = self.engine.captions(
                st.word_dicts(), [f.data for f in st.findings], captionEdits=st.caption_edits
            )
            verdict = check_caption_edit(caps, edit)
            if verdict == "locked":
                raise EditError("a quote is a locked unit: it can't be split or merged with speech")
            if verdict == "none":
                raise BadEdit(f"no caption fits a {body.op} at word {body.word}")
            return Change(captions=[*st.caption_edits, edit])

        return self._apply(lecture_id, f"caption_{body.op}", labels[body.op], body.model_dump(), build)

    # ---- machinery
    # -----------------------------------------------------------------------------------------------

    def _lock(self, lecture_id: int) -> threading.Lock:
        with self._locks_guard:
            return self._locks.setdefault(lecture_id, threading.Lock())

    def _lecture_of(self, finding_id: int) -> int:
        with self.db.session() as s:
            row = s.get(Finding, finding_id)
            if row is None or row.deleted:
                raise FindingNotFound(f"no finding {finding_id}")
            return row.lecture_id

    def _state(self, lecture_id: int) -> State:
        self.lectures.list_one(lecture_id)  # LectureNotFound
        with self.db.session() as s:
            words = [
                TimedWord(t, a, b)
                for t, a, b in s.execute(
                    select(Word.text, Word.start, Word.end)
                    .where(Word.lecture_id == lecture_id)
                    .order_by(Word.idx)
                )
            ]
            rows = s.scalars(
                select(Finding).where(Finding.lecture_id == lecture_id, Finding.deleted.is_(False))
            )
            findings = sorted(
                (Row(r.id, r.idx, r.engine, dict(r.data)) for r in rows),
                key=lambda r: (r.start, r.end, r.idx),
            )
            cap = s.get(CaptionEdits, lecture_id)
        engine = findings[0].engine if findings else self.detection.get_settings().engine
        return State(lecture_id, words, findings, list(cap.edits) if cap else [], engine)

    def _options(self, st: State) -> dict[str, Any]:
        return self.detection.engine_options(engine=st.engine)

    def _engine_edit(self, st: State, request: dict[str, Any]) -> dict[str, Any]:
        try:
            return self.engine.edit(request, st.word_dicts(), self._options(st))
        except EngineError as e:
            # edit.ts throws EditError for an edit that can't be made; the worker sends its stack, first line
            # "EditError: <why>". Anything else is a real engine failure.
            first = str(e).strip().splitlines()[0] if str(e).strip() else ""
            if first.startswith("EditError: "):
                raise EditError(first.removeprefix("EditError: ")) from None
            raise

    def _apply(
        self,
        lecture_id: int,
        kind: str,
        label: str,
        params: dict[str, Any],
        build: Callable[[State], Change],
        *,
        state: State | None = None,
    ) -> EditDone:
        with self._lock(lecture_id):
            st = state if state is not None else self._state(lecture_id)
            ch = build(st)
            if ch.empty():
                raise NothingChanged("nothing to change")
            undo: dict[str, Any] = {}
            with self.db.session() as s:
                if ch.words:
                    a, b, new = ch.words
                    undo["words"] = {
                        "start": a,
                        "count": len(new),
                        "old": [{"word": w.text, "start": w.start, "end": w.end} for w in st.words[a:b]],
                    }
                    self._write_words(s, lecture_id, a, b, new)
                touched = [*ch.update, *ch.remove]
                rows = (
                    {r.id: r for r in s.scalars(select(Finding).where(Finding.id.in_(touched)))}
                    if touched
                    else {}
                )
                undo["findings"] = [
                    {"id": r.id, "before": {**_finding_columns(r.data), "deleted": r.deleted}}
                    for r in rows.values()
                ]
                for fid, data in ch.update.items():
                    for k, v in _finding_columns(data).items():
                        setattr(rows[fid], k, v)
                for fid in ch.remove:
                    rows[fid].deleted = True
                added: list[int] = []
                if ch.add:
                    top = s.scalar(select(func.max(Finding.idx)).where(Finding.lecture_id == lecture_id))
                    top = -1 if top is None else top
                    for k, data in enumerate(ch.add):
                        row = Finding(
                            lecture_id=lecture_id, idx=top + 1 + k, engine=st.engine, **_finding_columns(data)
                        )
                        s.add(row)
                        s.flush()
                        added.append(row.id)
                    undo["added"] = added
                if ch.captions is not None:
                    undo["captions"] = st.caption_edits
                    self._write_captions(s, lecture_id, ch.captions)
                verdict_ids = []
                for v in ch.verdicts:
                    row_v = Verdict(**v)
                    s.add(row_v)
                    s.flush()
                    verdict_ids.append(row_v.id)
                verdict_ids += [vid for vid, _, _ in ch.saved]
                if verdict_ids:
                    undo["verdicts"] = verdict_ids
                if ch.saved:
                    undo["labels"] = [{"id": lid, "before": before} for _, lid, before in ch.saved]
                lecture = s.get(Lecture, lecture_id)
                if lecture is not None:
                    lecture.updated_at = utcnow()
                op = EditOp(lecture_id=lecture_id, kind=kind, label=label, params=params, undo=undo)
                s.add(op)
                s.flush()
                return EditDone(
                    op=self._op_out(op),
                    finding_id=ch.finding_id or (added[0] if added else None),
                    words_changed=ch.words is not None,
                    findings_changed=len(ch.update) + len(ch.remove) + len(added),
                    removed=list(ch.remove),
                    added=added,
                )

    @staticmethod
    def _write_words(s: Any, lecture_id: int, a: int, b: int, new: list[TimedWord]) -> None:
        """Replace words a..b-1 with `new`, moving the positions of the words after them."""
        delta = len(new) - (b - a)
        s.execute(delete(Word).where(Word.lecture_id == lecture_id, Word.idx >= a, Word.idx < b))
        if delta:
            # two steps, so no position is ever taken twice (positions are unique within a lecture)
            s.execute(
                update(Word)
                .where(Word.lecture_id == lecture_id, Word.idx >= b)
                .values(idx=-(Word.idx + delta) - 1)
            )
            s.execute(
                update(Word).where(Word.lecture_id == lecture_id, Word.idx < 0).values(idx=-Word.idx - 1)
            )
        if new:
            s.execute(
                insert(Word),
                [
                    dict(lecture_id=lecture_id, idx=a + k, text=w.text, start=w.start, end=w.end)
                    for k, w in enumerate(new)
                ],
            )

    @staticmethod
    def _write_captions(s: Any, lecture_id: int, edits: list[dict[str, Any]]) -> None:
        row = s.get(CaptionEdits, lecture_id)
        if not edits:
            if row is not None:
                s.delete(row)
        elif row is None:
            s.add(CaptionEdits(lecture_id=lecture_id, edits=edits))
        else:
            row.edits = edits

    @staticmethod
    def _op_out(op: EditOp) -> OpOut:
        return OpOut(
            id=op.id,
            kind=op.kind,
            label=op.label,
            params=op.params,
            created_at=op.created_at,
            undone=op.undone_at is not None,
        )


def check_caption_edit(captions: list[dict[str, Any]], edit: dict[str, Any]) -> str:
    """ "ok", "locked" (a quote) or "none" (no caption fits): engine/src/captions.ts checkCaptionEdit, the
    same
    rules, so the server refuses what the engine would skip."""
    w = int(edit["word"])
    if edit["op"] == "split":
        c = next((x for x in captions if x["wordStartIdx"] <= w <= x["wordEndIdx"]), None)
        if c is None:
            return "none"
        if c["type"] != "normal":
            return "locked"
        return "ok" if c["wordStartIdx"] < w else "none"
    k = next((i for i, x in enumerate(captions) if x["wordStartIdx"] == w), -1)
    if k < 0:
        return "none"
    if edit["op"] == "merge":
        if k == 0:
            return "none"
        return "ok" if captions[k]["type"] == "normal" and captions[k - 1]["type"] == "normal" else "locked"
    return "ok"
