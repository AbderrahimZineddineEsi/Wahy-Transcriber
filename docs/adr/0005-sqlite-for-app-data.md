# SQLite for app data; media, corpus and datasets stay files

Lectures, transcripts, findings, verdicts, labels, jobs and the AI request log live in one SQLite file
(`data/wahy.db`), accessed through SQLAlchemy with Alembic migrations. Media, the corpus, Tafrigh run folders and the
Laya datasets stay files under `data/`, which is ignored by git. Reason: the app has one user on one machine, so a
database server adds nothing, while the old IndexedDB storage hid the user's corrections from the server and the
datagen. Datasets stay files because Kaggle consumes files.

## Consequences

No migration from IndexedDB: the few saved lectures are re-run. Before anything moves, the old app's training bank is
exported to `data/legacy/` so no gold labels are lost.
