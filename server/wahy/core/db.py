"""The app's database: one SQLite file (ADR 0005), SQLAlchemy for access, Alembic for its shape.

    db = Database(settings.db_path)
    db.migrate()                      # brings the file up to the newest migration (creates it if missing)
    with db.session() as s:           # one unit of work: commits at the end, rolls back on an exception
        s.add(Lecture(title="..."))

Tables are declared next to the code that owns them (features/*/models.py, core/jobs.py, core/ai/models.py) on
the shared `Base` below; `wahy/tables.py` imports them all so Alembic sees the complete schema. The schema
only changes through a migration in server/migrations/versions/: change a model, then
`uv run alembic revision --autogenerate -m "what changed"` and read the file it writes before committing it.

Threads: job threads and request handlers each open their own session; never share a session between threads.
SQLite allows one writer at a time, so writers wait for each other (busy timeout) instead of failing.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import Engine, MetaData, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

SERVER_DIR = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = SERVER_DIR / "migrations"

# Stable constraint names: SQLite can't alter a table in place, so Alembic rebuilds it ("batch mode") and
# needs to know each constraint by name.
NAMING = {
    "ix": "ix_%(column_0_N_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


def utcnow() -> datetime:
    """Every stored time is UTC. SQLite keeps no time zone, so values read back are naive datetimes in UTC."""
    return datetime.now(UTC).replace(tzinfo=None)


def make_engine(db_path: Path | str) -> Engine:
    """A SQLAlchemy engine for the SQLite file at `db_path` (":memory:" is not supported: jobs use other
    threads)."""
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(engine, "connect")
    def _pragmas(dbapi_connection, _record) -> None:
        cur = dbapi_connection.cursor()
        # off by default in SQLite: without it ON DELETE CASCADE is ignored
        cur.execute("PRAGMA foreign_keys = ON")
        # readers don't block the writer (the web app reads while jobs write)
        cur.execute("PRAGMA journal_mode = WAL")
        cur.execute("PRAGMA synchronous = NORMAL")  # safe with WAL, much faster than FULL
        cur.close()

    return engine


class Database:
    def __init__(self, db_path: Path | str):
        self.path = Path(db_path)
        self.engine = make_engine(self.path)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)

    @contextmanager
    def session(self) -> Iterator[Session]:
        """One unit of work: commits when the block ends, rolls back if it raises."""
        with self.sessions.begin() as s:
            yield s

    def migrate(self, revision: str = "head") -> None:
        """Run Alembic migrations up to `revision` on this database."""
        from alembic import command

        with self.engine.begin() as connection:
            cfg = alembic_config()
            cfg.attributes["connection"] = connection   # env.py uses this connection instead of a URL
            command.upgrade(cfg, revision)

    def dispose(self) -> None:
        self.engine.dispose()


def alembic_config():
    from alembic.config import Config

    cfg = Config(str(SERVER_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    return cfg
