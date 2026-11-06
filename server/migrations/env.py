"""Runs the migrations. Two ways in:
- from the app (`Database.migrate()`), which passes its own connection in `config.attributes["connection"]`;
- from the command line (`uv run alembic ...`), which uses the database the settings point at (data/wahy.db).
"""

from logging.config import fileConfig

from alembic import context

from wahy.core.db import make_engine
from wahy.core.settings import Settings
from wahy.tables import Base

config = context.config
target_metadata = Base.metadata


def run(connection) -> None:
    # render_as_batch: SQLite can't ALTER a column, so Alembic copies the table instead ("batch mode")
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True,
                      compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    raise SystemExit("offline (--sql) migrations are not supported here")

connection = config.attributes.get("connection")
if connection is not None:
    run(connection)
else:
    if config.config_file_name is not None:
        fileConfig(config.config_file_name)     # command-line logging; the app keeps its own
    engine = make_engine(Settings().db_path)
    with engine.connect() as conn:
        run(conn)
    engine.dispose()
