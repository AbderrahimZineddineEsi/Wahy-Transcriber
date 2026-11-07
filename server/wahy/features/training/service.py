"""Training data (ROADMAP phase 20): the rows Laya learns from, where each one came from, and the files Kaggle
reads.

    training = TrainingService(db, settings, engine, verification, tafrigh)
    training.page(origin="user")                    # counters and rows (F-100, F-104)
    training.export("verification")                 # the Laya JSONL file (F-101), byte-equal to the old app's
    training.import_text(text, "bank.jsonl")        # the old app's exported bank (F-100), or a Tafrigh save
    training.save_tafrigh(run_id, TafrighSaveIn(segment_ids=[...]))   # a Tafrigh run's sentences (F-120)
    training.clear()                                # F-103

Where rows come from (their lineage):
- **labels** (features/training/models.py), one row each: the user's gold labels (verdict buttons, approve
  all, a finding deleted as ordinary speech, a missed quote added by hand; saved by verification and editing),
  rows imported from the old app's training bank (`legacy`), and Tafrigh sentences saved for Laya (`tafrigh`).
- **verdicts**: a verifier's newest verdict on a live finding that has no label of the user's, as the old app
  kept every AI verdict in its bank. Clearing the training data hides the verdicts given before it (they stay
  on their lectures).

The Laya rows are written by the engine (engine/src/training.ts, the old app's converter), so the bytes are
the old app's: an imported bank exports exactly as it was imported.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select

from wahy.core.db import Database, utcnow
from wahy.core.engine import EngineClient
from wahy.core.settings import Settings
from wahy.features.detection.models import Finding
from wahy.features.lectures.models import Lecture
from wahy.features.settings.store import SettingsStore
from wahy.features.tafrigh.laya_export import SCHEMA_VERSION as TAFRIGH_SCHEMA
from wahy.features.tafrigh.laya_export import build_examples
from wahy.features.tafrigh.service import TafrighService
from wahy.features.training.models import Label
from wahy.features.training.schemas import (
    Imported,
    TafrighSaved,
    TafrighSaveIn,
    TrainingCounts,
    TrainingPage,
    TrainingRow,
    TrainingRowJson,
)
from wahy.features.verification.models import Verdict
from wahy.features.verification.service import VerificationService

CLEARED_KEY = "training.cleared_at"
HUMAN_CONFIDENCE = 0.98
# the app's boundary words → the Laya rows' (the old app's) words
TO_LAYA_BOUNDARY = {"COMPLETE": "COMPLETE_SPAN"}
FROM_LAYA_BOUNDARY = {"COMPLETE_SPAN": "COMPLETE"}


class TrainingError(ValueError):
    pass


class RowNotFound(KeyError):
    pass


@dataclass
class Item:
    """One training row: what the screen shows, and what the export needs to write it."""

    row: TrainingRow
    label: Label | None = None
    verdict: Verdict | None = None
    finding: Finding | None = None


def _ts(dt: datetime) -> int:
    return int(dt.replace(tzinfo=UTC).timestamp())


def _iso_ms(dt: datetime) -> str:
    """JavaScript's toISOString(): milliseconds and a Z."""
    return dt.replace(tzinfo=UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _laya_boundary(b: str | None) -> str | None:
    return TO_LAYA_BOUNDARY.get(b, b) if b else None


class TrainingService:
    def __init__(
        self,
        db: Database,
        settings: Settings,
        engine: EngineClient,
        verification: VerificationService,
        tafrigh: TafrighService,
    ):
        self.db, self.settings, self.engine = db, settings, engine
        self.verification, self.tafrigh = verification, tafrigh
        self.store = SettingsStore(db)

    @property
    def legacy_dir(self) -> Path:
        """Where the old app's exports were to be put (ROADMAP phase 2)."""
        return self.settings.data_dir / "legacy"

    # ---- reading -------------------------------------------------------------------------------------------

    def page(
        self,
        *,
        origin: str | None = None,
        task: str | None = None,
        label: str | None = None,
        q: str | None = None,
        lecture_id: int | None = None,
        limit: int = 500,
    ) -> TrainingPage:
        """Counters over every row, and the rows that match the filters, newest first (F-104).
        origin: gold | user | approval | legacy | tafrigh | ai; task: verification | tafrigh;
        label: CORRECT | FALSE | NOT_SURE | CLIPPED."""
        items = self._items()
        counts = self._counts([i.row for i in items])
        rows = [i.row for i in items if self._matches(i.row, origin, task, label, q, lecture_id)]
        rows.reverse()
        return TrainingPage(counts=counts, rows=rows[:limit], matching=len(rows))

    def row_json(self, row_id: str) -> TrainingRowJson:
        """The line this row writes to its JSONL file."""
        item = next((i for i in self._items() if i.row.id == row_id), None)
        if item is None:
            raise RowNotFound(row_id)
        if item.row.task != "verification":
            return TrainingRowJson(id=row_id, row=self._tafrigh_line(item.label))  # type: ignore[arg-type]
        text = self._laya_jsonl([item], now=_ts(utcnow()))
        return TrainingRowJson(id=row_id, row=json.loads(text))

    @staticmethod
    def _matches(
        r: TrainingRow,
        origin: str | None,
        task: str | None,
        label: str | None,
        q: str | None,
        lecture_id: int | None,
    ) -> bool:
        if origin and origin != "all":
            ok = {
                "gold": r.gold,
                "user": r.origin == "user",
                "approval": r.action == "VALIDATE_ALL",
                "legacy": r.origin == "legacy",
                "tafrigh": r.origin == "tafrigh",
                "ai": not r.gold,
            }.get(origin)
            if ok is None:
                raise TrainingError(f"unknown origin {origin!r}")
            if not ok:
                return False
        if task and task != "all":
            if task not in ("verification", "tafrigh"):
                raise TrainingError(f"unknown task {task!r}")
            if (r.task == "verification") != (task == "verification"):
                return False
        if label and label != "ALL":
            if label == "CLIPPED":
                if r.task != "verification" or not r.boundary or r.boundary == "COMPLETE":
                    return False
            elif label in ("CORRECT", "FALSE", "NOT_SURE"):
                if r.task != "verification" or r.verdict != label:
                    return False
            else:
                raise TrainingError(f"unknown label {label!r}")
        if lecture_id is not None and r.lecture_id != lecture_id:
            return False
        if q:
            needle = q.strip().lower()
            if needle and needle not in (r.text or "").lower() and needle not in (r.reference or "").lower():
                return False
        return True

    @staticmethod
    def _counts(rows: list[TrainingRow]) -> TrainingCounts:
        ver = [r for r in rows if r.task == "verification"]
        return TrainingCounts(
            total=len(rows),
            correct=sum(r.verdict == "CORRECT" for r in ver),
            false=sum(r.verdict == "FALSE" for r in ver),
            not_sure=sum(r.verdict == "NOT_SURE" for r in ver),
            clipped=sum(bool(r.boundary) and r.boundary != "COMPLETE" for r in ver),
            gold=sum(r.gold for r in rows),
            ai=sum(not r.gold for r in rows),
            missed=sum(r.action == "MISSED_QUOTE" for r in rows),
            segmentation=sum(r.task == "tafrigh_structure" for r in rows),
            typo=sum(r.typo for r in rows),
        )

    def _items(self) -> list[Item]:
        """Every training row, oldest first (the export's order)."""
        cleared = self.store.get(CLEARED_KEY)
        cleared_at = datetime.fromisoformat(cleared) if cleared else None
        with self.db.session() as s:
            titles = dict(s.execute(select(Lecture.id, Lecture.title)).all())
            labels = list(s.scalars(select(Label).order_by(Label.id)))
            linked = {lab.finding_id for lab in labels if lab.finding_id is not None}
            live = (
                {f.id: f for f in s.scalars(select(Finding).where(Finding.id.in_(linked)))} if linked else {}
            )
            gold_findings = {lab.finding_id for lab in labels if lab.source == "user" and lab.finding_id}
            newest = (
                select(func.max(Verdict.id))
                .join(Finding, Finding.id == Verdict.finding_id)
                .where(Verdict.verifier != "human", Finding.deleted.is_(False))
                .group_by(Verdict.finding_id)
            )
            verdicts = list(s.scalars(select(Verdict).where(Verdict.id.in_(newest)).order_by(Verdict.id)))
            vfind = (
                {
                    f.id: f
                    for f in s.scalars(
                        select(Finding).where(Finding.id.in_([v.finding_id for v in verdicts]))
                    )
                }
                if verdicts
                else {}
            )
            s.expunge_all()

        items: list[Item] = []
        for lab in labels:
            items.append(self._label_item(lab, live.get(lab.finding_id) if lab.finding_id else None, titles))
        for v in verdicts:
            f = vfind.get(v.finding_id)
            if f is None or v.finding_id in gold_findings:
                continue
            if cleared_at is not None and v.created_at <= cleared_at:
                continue
            items.append(
                Item(
                    row=TrainingRow(
                        id=f"verdict:{v.id}",
                        origin="ai",
                        action=None,
                        gold=False,
                        task="verification",
                        reference=f.display_ref,
                        source_type=f.source_type,
                        text=str(f.data.get("matchedText") or ""),
                        verdict=v.verdict,
                        ai_verdict=v.verdict,
                        boundary=v.boundary,
                        ref_issue=bool(f.data.get("referenceWrong")),
                        provider=v.model or v.verifier,
                        lecture_id=f.lecture_id,
                        lecture_title=titles.get(f.lecture_id),
                        finding_id=f.id,
                        created_at=v.created_at,
                    ),
                    verdict=v,
                    finding=f,
                )
            )
        items.sort(key=lambda i: (i.row.created_at, 0 if i.label else 1, i.row.id))
        return items

    @staticmethod
    def _label_item(lab: Label, finding: Finding | None, titles: dict[int, str]) -> Item:
        card = lab.card or {}
        lecture_title = titles.get(lab.lecture_id) if lab.lecture_id else None
        base = dict(
            id=f"label:{lab.id}",
            lecture_id=lab.lecture_id,
            finding_id=lab.finding_id,
            created_at=lab.created_at,
        )
        if lab.source == "legacy":
            row = card.get("row") or {}
            st, meta = row.get("state") or {}, row.get("meta") or {}
            gold = bool(meta.get("human_verified"))
            b = ((row.get("answers") or {}).get("boundary_status") or {}).get("choice")
            r = TrainingRow(
                **base,
                origin="legacy",
                action=None,
                gold=gold,
                task="verification",
                reference=st.get("candidate_reference"),
                source_type=st.get("source_type"),
                text=str(st.get("matched_span_in_lecture") or st.get("canonical_corpus_text") or ""),
                verdict=lab.verdict,
                ai_verdict=None if gold else lab.verdict,
                boundary=FROM_LAYA_BOUNDARY.get(b, b) if b else None,
                ref_issue=bool(meta.get("ref_issue")),
                provider=meta.get("source_provider"),
                lecture_title=lecture_title or meta.get("lecture_title"),
            )
            return Item(row=r, label=lab)
        if lab.source == "tafrigh":
            ex, meta = card.get("example") or {}, card.get("meta") or {}
            answers, st = ex.get("answers") or {}, ex.get("state") or {}
            answer = (
                answers.get("tag")
                if ex.get("task") == "tafrigh_structure"
                else ("split" if answers.get("needsSplitting") == "true" else "no split")
            )
            r = TrainingRow(
                **base,
                origin="tafrigh",
                action=ex.get("label_source"),
                gold=str(ex.get("label_source") or "").startswith("human"),
                task=ex.get("task") or "tafrigh_structure",
                reference=None,
                source_type=None,
                text=str(st.get("target_text") or ""),
                verdict=answer,
                ai_verdict=(ex.get("model_answers") or {}).get("tag"),
                boundary=None,
                typo=answers.get("hasTypo") == "true",
                provider=meta.get("model_candidate"),
                lecture_title=lecture_title or meta.get("lecture_title"),
                run_id=ex.get("run_id"),
            )
            return Item(row=r, label=lab)
        # the user's own label (source user); a teacher's label (phase 22) reads the same card
        f = card.get("finding") or {}
        v = card.get("verdict") or {}
        ai = v.get("ai") or {}
        data = finding.data if finding is not None else f
        r = TrainingRow(
            **base,
            origin="user",
            action=v.get("user_action"),
            gold=lab.source == "user",
            task="verification",
            reference=f.get("displayRef"),
            source_type=f.get("sourceType"),
            text=str(f.get("matchedText") or ""),
            verdict=lab.verdict,
            ai_verdict=ai.get("verdict"),
            boundary=lab.boundary,
            ref_issue=bool(data.get("referenceWrong")),
            provider=lab.teacher,
            lecture_title=lecture_title or (card.get("lecture") or {}).get("title"),
        )
        return Item(row=r, label=lab, finding=finding)

    # ---- export --------------------------------------------------------------------------------------------

    def export(self, task: str = "verification", *, gold_only: bool = False) -> tuple[str, str]:
        """(file name, JSONL text). verification: the Laya rows (F-101), as the old app wrote them; tafrigh:
        the Tafrigh examples, as the old app's "save run" file wrote them."""
        now = _ts(utcnow())
        items = [i for i in self._items() if (i.row.gold or not gold_only)]
        if task == "verification":
            items = [i for i in items if i.row.task == "verification"]
            return f"wahy_laya_train_{now}.jsonl", self._laya_jsonl(items, now=now)
        if task == "tafrigh":
            lines = [
                json.dumps(self._tafrigh_line(i.label), ensure_ascii=False)  # type: ignore[arg-type]
                for i in items
                if i.row.task != "verification"
            ]
            return f"wahy_tafrigh_laya_{now}.jsonl", "".join(line + "\n" for line in lines)
        raise TrainingError(f"unknown task {task!r} (verification or tafrigh)")

    @staticmethod
    def _tafrigh_line(lab: Label) -> dict[str, Any]:
        card = lab.card or {}
        return dict(card.get("example") or {}, saved_at=card.get("saved_at"), meta=card.get("meta"))

    def _laya_jsonl(self, items: list[Item], *, now: int) -> str:
        """The rows through the engine's converter (engine/src/training.ts): stored rows pass through as they
        are, labels and verdicts are converted with their v1 envelope."""
        envs = self._ai_envelopes([i for i in items if i.verdict is not None])
        records: list[dict[str, Any]] = []
        for i in items:
            if i.label is not None and i.label.source == "legacy":
                records.append(i.label.card["row"])
            elif i.label is not None:
                records.append(self._label_record(i))
            else:
                env = envs.get(i.verdict.finding_id)  # type: ignore[union-attr]
                if env is None:
                    continue  # its lecture's words or findings changed under it: nothing to write
                records.append(self._verdict_record(i, env))
        if not records:
            return ""
        return self.engine.call("laya_jsonl", records=records, now=now)["jsonl"]

    def _ai_envelopes(self, items: list[Item]) -> dict[int, dict[str, Any]]:
        by_lecture: dict[int, list[int]] = {}
        for i in items:
            by_lecture.setdefault(i.finding.lecture_id, []).append(i.finding.id)  # type: ignore[union-attr]
        out: dict[int, dict[str, Any]] = {}
        for lecture_id, ids in by_lecture.items():
            out.update(self.verification.v1_envelopes(lecture_id, ids))
        return out

    @staticmethod
    def _label_record(i: Item) -> dict[str, Any]:
        """A user's label as the old app's setHumanOverrideVerdict stored it: the earlier AI verdict's model
        and
        boundary odds carried over, the verdict made certain."""
        lab = i.label
        assert lab is not None
        card = lab.card or {}
        v = card.get("verdict") or {}
        ai = v.get("ai") or {}
        details = ai.get("details") or {}
        info: dict[str, Any] = {"verdict": lab.verdict, "confidence": HUMAN_CONFIDENCE, "humanOverride": True}
        boundary = _laya_boundary(lab.boundary)
        if boundary:
            info["boundaryStatus"] = boundary
            if ai and _laya_boundary(ai.get("boundary")) == boundary:
                if details.get("boundary_confidence") is not None:
                    info["boundaryConfidence"] = details["boundary_confidence"]
                if details.get("boundary_probabilities"):
                    info["boundaryProbabilities"] = details["boundary_probabilities"]
            elif ai and ai.get("boundary"):
                info["boundaryConfidence"] = HUMAN_CONFIDENCE  # the user changed the verifier's boundary
        if ai.get("model"):
            info["modelUsed"] = ai["model"]
        if ai.get("verifier"):
            info["provider"] = ai["verifier"]
        live = i.finding.data if i.finding is not None else (card.get("finding") or {})
        rec: dict[str, Any] = {
            "aiVerification": info,
            "envelope": {
                "state": (card.get("envelope") or {}).get("state"),
                "questions": (card.get("envelope") or {}).get("questions"),
            },
            "id": f"wahy_dec_{_ts(lab.created_at)}_{lab.id}",
            "convertedAt": _ts(lab.updated_at),
            "lectureTitle": (card.get("lecture") or {}).get("title") or "",
        }
        if live.get("referenceWrong"):
            rec["refIssue"] = True
        if v.get("user_action") == "VALIDATE_ALL":
            rec["humanGoldResolution"] = {
                "verdict": lab.verdict,
                "user_action": "VALIDATE_ALL",
                "timestamp": _iso_ms(lab.updated_at),
            }
        return rec

    @staticmethod
    def _verdict_record(i: Item, env: dict[str, Any]) -> dict[str, Any]:
        v = i.verdict
        assert v is not None and i.finding is not None
        d = v.details or {}
        info: dict[str, Any] = {"verdict": v.verdict}
        if v.confidence is not None:
            info["confidence"] = v.confidence
        if d.get("probabilities"):
            info["probabilities"] = d["probabilities"]
        if v.boundary:
            info["boundaryStatus"] = _laya_boundary(v.boundary)
        if d.get("boundary_confidence") is not None:
            info["boundaryConfidence"] = d["boundary_confidence"]
        if d.get("boundary_probabilities"):
            info["boundaryProbabilities"] = d["boundary_probabilities"]
        if v.model:
            info["modelUsed"] = v.model
        info["provider"] = v.verifier
        rec: dict[str, Any] = {
            "aiVerification": info,
            "envelope": {"state": env.get("state"), "questions": env.get("questions")},
            "id": f"wahy_verdict_{v.id}",
            "lectureTitle": i.row.lecture_title or "",
        }
        if i.finding.data.get("referenceWrong"):
            rec["refIssue"] = True
        return rec

    # ---- import --------------------------------------------------------------------------------------------

    def import_text(self, text: str, name: str = "upload") -> Imported:
        """Rows from the old app's exported training bank (its Laya JSONL export, F-100) or a Tafrigh
        "save run"
        file (F-120). A row already imported (same id) is saved again, not added twice."""
        objs, skipped = self._parse(text)
        added = replaced = 0
        with self.db.session() as s:
            existing = {lab.key: lab for lab in s.scalars(select(Label).where(Label.key.is_not(None)))}
            for obj in objs:
                values = self._import_values(obj)
                if values is None:
                    skipped += 1
                    continue
                lab = existing.get(values["key"])
                if lab is None:
                    lab = Label(**values)
                    s.add(lab)
                    existing[values["key"]] = lab
                    added += 1
                else:
                    for k, val in values.items():
                        setattr(lab, k, val)
                    replaced += 1
        return Imported(imported=added, replaced=replaced, skipped=skipped, files=[name])

    def import_legacy_folder(self) -> Imported:
        """Every .jsonl / .json file in data/legacy/ (the old app's exports, ROADMAP phase 2)."""
        total = Imported(imported=0, replaced=0, skipped=0, files=[])
        if not self.legacy_dir.is_dir():
            return total
        for path in sorted(self.legacy_dir.iterdir()):
            if path.suffix.lower() not in (".jsonl", ".json") or not path.is_file():
                continue
            got = self.import_text(path.read_text(encoding="utf-8"), path.name)
            total.imported += got.imported
            total.replaced += got.replaced
            total.skipped += got.skipped
            total.files.append(path.name)
        return total

    @staticmethod
    def _parse(text: str) -> tuple[list[Any], int]:
        text = text.lstrip("﻿")
        stripped = text.strip()
        if stripped.startswith("["):
            try:
                data = json.loads(stripped)
            except ValueError:
                raise TrainingError("the file is not valid JSON") from None
            return (data if isinstance(data, list) else []), 0
        objs, bad = [], 0
        for line in text.splitlines():
            if not line.strip():
                continue
            try:
                objs.append(json.loads(line))
            except ValueError:
                bad += 1
        if stripped.startswith("{") and not objs and bad:
            try:
                data = json.loads(stripped)
            except ValueError:
                raise TrainingError("the file is neither JSON lines nor JSON") from None
            records = data.get("records") if isinstance(data, dict) else None
            return (records if isinstance(records, list) else [data]), 0
        return objs, bad

    @staticmethod
    def _import_values(obj: Any) -> dict[str, Any] | None:
        if not isinstance(obj, dict) or not (
            obj.get("state") and obj.get("questions") and obj.get("answers")
        ):
            return None
        if obj.get("schema_version") == TAFRIGH_SCHEMA:
            if not obj.get("run_id") or not obj.get("segment_id"):
                return None
            example = {k: v for k, v in obj.items() if k not in ("saved_at", "meta")}
            return dict(
                key=f"tafrigh:{obj['run_id']}:{obj.get('task')}:{obj['segment_id']}",
                source="tafrigh",
                task=obj.get("task")
                if obj.get("task") in ("tafrigh_structure", "tafrigh_split")
                else "tafrigh_structure",
                verdict=None,
                boundary=None,
                finding_id=None,
                lecture_id=None,
                card={"example": example, "meta": obj.get("meta"), "saved_at": obj.get("saved_at")},
            )
        if not obj.get("id"):
            return None
        answers = obj["answers"] if isinstance(obj["answers"], dict) else {}
        verdict = (
            (answers.get("verdict") or {}).get("choice") if isinstance(answers.get("verdict"), dict) else None
        )
        b = (
            (answers.get("boundary_status") or {}).get("choice")
            if isinstance(answers.get("boundary_status"), dict)
            else None
        )
        return dict(
            key=f"legacy:{obj['id']}",
            source="legacy",
            task="verification",
            verdict=str(verdict or "CORRECT").upper(),
            boundary=FROM_LAYA_BOUNDARY.get(b, b) if b else None,
            finding_id=None,
            lecture_id=None,
            card={"row": obj},
        )

    # ---- Tafrigh -------------------------------------------------------------------------------------------

    def save_tafrigh(self, run_id: str, body: TafrighSaveIn) -> TafrighSaved:
        """F-120: the chosen sentences of a Tafrigh run, with their current (possibly corrected) labels, as
        Laya
        examples. Saving the run again replaces its examples."""
        session = self.tafrigh._session(run_id)  # RunNotFound
        with session.lock:
            segments = list(session.segments)
            known = {x.id for x in segments}
            chosen = [sid for sid in dict.fromkeys(body.segment_ids) if sid in known]
            if not chosen:
                raise TrainingError("none of these sentences is in the run")
            examples = build_examples(run_id, segments, chosen)
            lecture_id = session.meta.get("lecture_id")
            model = (session.manifest or {}).get("model_candidate")
        now = utcnow()
        with self.db.session() as s:
            lecture = s.get(Lecture, lecture_id) if isinstance(lecture_id, int) else None
            meta = {
                "lecture_title": lecture.title if lecture else None,
                "model_candidate": model,
                "note": body.note or None,
            }
            s.execute(delete(Label).where(Label.key.like(f"tafrigh:{run_id}:%")))
            for ex in examples:
                s.add(
                    Label(
                        key=f"tafrigh:{run_id}:{ex['task']}:{ex['segment_id']}",
                        source="tafrigh",
                        task=ex["task"],
                        verdict=None,
                        boundary=None,
                        finding_id=None,
                        lecture_id=lecture.id if lecture else None,
                        card={"example": ex, "meta": meta, "saved_at": now.replace(tzinfo=UTC).isoformat()},
                        created_at=now,
                        updated_at=now,
                    )
                )
        by_source: dict[str, int] = {}
        for ex in examples:
            by_source[ex["label_source"]] = by_source.get(ex["label_source"], 0) + 1
        return TafrighSaved(
            run_id=run_id,
            segment_ids=chosen,
            sentences=len(chosen),
            count=len(examples),
            by_source=by_source,
            note=body.note or None,
            saved_at=now,
        )

    def tafrigh_saved(self, run_id: str) -> TafrighSaved | None:
        """What a Tafrigh run has saved for Laya, or None."""
        self.tafrigh._session(run_id)  # RunNotFound
        with self.db.session() as s:
            labs = list(
                s.scalars(select(Label).where(Label.key.like(f"tafrigh:{run_id}:%")).order_by(Label.id))
            )
            s.expunge_all()
        if not labs:
            return None
        examples = [(lab.card or {}).get("example") or {} for lab in labs]
        meta = (labs[0].card or {}).get("meta") or {}
        chosen = [ex["segment_id"] for ex in examples if ex.get("task") == "tafrigh_structure"]
        by_source: dict[str, int] = {}
        for ex in examples:
            by_source[ex.get("label_source", "model")] = by_source.get(ex.get("label_source", "model"), 0) + 1
        return TafrighSaved(
            run_id=run_id,
            segment_ids=chosen,
            sentences=len(chosen),
            count=len(examples),
            by_source=by_source,
            note=meta.get("note"),
            saved_at=labs[0].created_at,
        )

    # ---- clear ---------------------------------------------------------------------------------------------

    def clear(self) -> int:
        """F-103: delete every label, and hide the verifiers' verdicts given so far (they stay on their
        lectures). Returns how many rows went."""
        n = len(self._items())
        with self.db.session() as s:
            s.execute(delete(Label))
        self.store.set(CLEARED_KEY, utcnow().isoformat())
        return n


__all__ = ["RowNotFound", "TrainingError", "TrainingService"]
