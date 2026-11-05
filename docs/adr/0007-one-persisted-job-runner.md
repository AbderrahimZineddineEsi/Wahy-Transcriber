# One job runner for all long work, with job state in SQLite

Transcription, detection, verification passes and Tafrigh runs are all jobs in one in-process job runner that
records each job's progress and status in SQLite and supports pause, resume and cancel. The web app follows a job
through one progress stream. After a server restart, unfinished jobs show as interrupted and can be resumed where the
work allows it. Reason: the old code had two separate in-memory job systems that lost everything on restart, and
verification ran in the browser tab, so closing the tab stopped it.

## Considered Options

- Celery or RQ with Redis: built for many machines and many users; here it would only add a second service to run.
