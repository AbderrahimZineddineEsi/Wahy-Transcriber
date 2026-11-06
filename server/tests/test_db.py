"""The database through its interface: migrations build the schema the models describe, and SQLite enforces
it."""

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import IntegrityError

from wahy.core.db import Database
from wahy.tables import AiRequest, Base, Finding, Job, Label, Lecture, LectureVersion, Verdict, Word

TABLES = {"lectures", "lecture_versions", "words", "findings", "verdicts", "labels", "jobs", "ai_requests",
          "settings", "adhkar", "custom_quotes"}


def test_migrating_creates_every_table(db: Database):
    assert set(inspect(db.engine).get_table_names()) == TABLES | {"alembic_version"}


def test_the_migrations_match_the_models(db: Database):
    """If this fails, a model changed without a migration: run `uv run alembic revision --autogenerate`."""
    with db.engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn, opts={"compare_type": True}), Base.metadata)
    assert diff == []


def test_migrating_again_changes_nothing(db: Database):
    with db.session() as s:
        s.add(Lecture(title="t", source_kind="text"))
    db.migrate()
    with db.session() as s:
        assert s.scalar(select(Lecture.title)) == "t"


def test_sqlite_runs_in_wal_mode_with_foreign_keys(db: Database):
    with db.engine.connect() as conn:
        assert conn.scalar(text("PRAGMA journal_mode")) == "wal"
        assert conn.scalar(text("PRAGMA foreign_keys")) == 1


def _lecture_with_everything(db: Database) -> int:
    with db.session() as s:
        lecture = Lecture(title="درس", source_kind="youtube", source_url="https://youtu.be/x")
        s.add(lecture)
        s.flush()
        s.add_all([Word(lecture_id=lecture.id, idx=i, text=w, start=i, end=i + 0.5)
                   for i, w in enumerate("قل هو الله أحد".split())])
        finding = Finding(lecture_id=lecture.id, idx=0, engine="v5", source_type="QURAN", unit_id="112:1",
                          display_ref="الإخلاص: 1", word_start=0, word_end=3,
                          data={"matchedText": "قل هو الله أحد", "segments": [[0, 3]]})
        s.add(finding)
        s.add(Job(id="j1", kind="verify", status="done", lecture_id=lecture.id, params={}, progress={}))
        s.flush()
        request = AiRequest(provider="fake", model="m", purpose="verify", job_id="j1", ok=True,
                            request={"q": 1})
        s.add(request)
        s.flush()
        s.add(Verdict(finding_id=finding.id, verifier="laya", verdict="CORRECT", boundary="COMPLETE",
                      job_id="j1", ai_request_id=request.id))
        s.add(Label(finding_id=finding.id, lecture_id=lecture.id, source="user", verdict="CORRECT",
                    card={"matchedText": "قل هو الله أحد"}))
        s.add(LectureVersion(lecture_id=lecture.id, name="first pass",
                             snapshot={"findings": [], "verdicts": []}))
        return lecture.id


def test_deleting_a_lecture_removes_its_data_but_keeps_labels_and_the_request_log(db: Database):
    lecture_id = _lecture_with_everything(db)
    with db.session() as s:
        s.delete(s.get(Lecture, lecture_id))
    with db.session() as s:
        for table in (Word, Finding, Verdict, LectureVersion):
            assert s.scalars(select(table)).all() == [], table.__tablename__
        label = s.scalars(select(Label)).one()               # training truth outlives the lecture
        assert (label.finding_id, label.lecture_id) == (None, None)
        assert label.card == {"matchedText": "قل هو الله أحد"}
        assert s.scalars(select(Job)).one().lecture_id is None
        assert s.scalars(select(AiRequest)).one().job_id == "j1"


def test_json_columns_keep_arabic_and_structure(db: Database):
    _lecture_with_everything(db)
    with db.session() as s:
        data = s.scalars(select(Finding)).one().data
        assert data == {"matchedText": "قل هو الله أحد", "segments": [[0, 3]]}


def test_a_word_position_is_unique_within_a_lecture(db: Database):
    lecture_id = _lecture_with_everything(db)
    with pytest.raises(IntegrityError), db.session() as s:
        s.add(Word(lecture_id=lecture_id, idx=0, text="مكرر", start=0, end=1))


def test_a_finding_needs_an_existing_lecture(db: Database):
    with pytest.raises(IntegrityError), db.session() as s:
        s.add(Finding(lecture_id=999, idx=0, engine="v5", source_type="QURAN", word_start=0, word_end=0,
                      data={}))
