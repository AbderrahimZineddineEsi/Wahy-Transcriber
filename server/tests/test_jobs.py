"""The job runner through its interface: submit, progress, pause, resume, cancel, restart, and the HTTP routes
with the progress stream."""

import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from tests.helpers import wait_for
from wahy.core.db import Database
from wahy.core.jobs import JobContext, JobError, JobNotFound, JobRunner
from wahy.main import create_app
from wahy.tables import Job, Lecture


class Loop:
    """A job that checks in a loop until the test lets it finish, counting its steps."""

    def __init__(self):
        self.started = threading.Event()
        self.finish = threading.Event()
        self.steps = 0

    def __call__(self, ctx: JobContext):
        self.started.set()
        while not self.finish.is_set():
            ctx.check()
            self.steps += 1
            time.sleep(0.002)
        return {"steps": self.steps}


def status(runner: JobRunner, job_id: str) -> str:
    return runner.get(job_id).status


def test_a_job_runs_in_the_background_and_its_result_is_saved(runner: JobRunner, db: Database):
    runner.register("double", lambda ctx: {"answer": ctx.params["n"] * 2})
    job = runner.submit("double", {"n": 21})
    assert job.status == "queued"                       # submit returns at once
    done = runner.wait(job.id, timeout=5)
    assert (done.status, done.result, done.error) == ("done", {"answer": 42}, None)
    assert done.started_at is not None and done.finished_at is not None
    with db.session() as s:                             # saved, not only in memory
        row = s.get(Job, job.id)
        assert (row.status, row.result) == ("done", {"answer": 42})


def test_a_failing_job_records_the_error(runner: JobRunner):
    def boom(ctx):
        raise ValueError("no audio stream")

    runner.register("boom", boom)
    done = runner.wait(runner.submit("boom").id, timeout=5)
    assert (done.status, done.error) == ("failed", "ValueError: no audio stream")


def test_progress_is_merged_saved_and_given_a_percent(runner: JobRunner, db: Database):
    def steps(ctx: JobContext):
        ctx.progress(stage="download", percent=100)
        for i in range(4):
            ctx.progress(stage="transcribe", done=i + 1, total=4)
        ctx.progress(requests=7)                       # any extra counter a job wants to show

    runner.register("steps", steps)
    done = runner.wait(runner.submit("steps").id, timeout=5)
    assert done.progress == {"stage": "transcribe", "done": 4, "total": 4, "percent": 100.0, "requests": 7}
    with db.session() as s:
        assert s.get(Job, done.id).progress == done.progress


def test_pause_stops_the_job_at_its_next_check_and_resume_continues_it(runner: JobRunner):
    loop = Loop()
    runner.register("loop", loop)
    job = runner.submit("loop")
    loop.started.wait(5)
    assert runner.pause(job.id).status == "pausing"
    wait_for(lambda: status(runner, job.id) == "paused", what="paused")
    frozen = loop.steps
    time.sleep(0.1)
    assert loop.steps == frozen                        # nothing runs while paused
    assert runner.resume(job.id).status in ("paused", "running")
    wait_for(lambda: loop.steps > frozen, what="steps after resume")
    assert status(runner, job.id) == "running"
    loop.finish.set()
    assert runner.wait(job.id, timeout=5).status == "done"


def test_cancel_stops_a_running_job(runner: JobRunner):
    loop = Loop()
    runner.register("loop", loop)
    job = runner.submit("loop")
    loop.started.wait(5)
    assert runner.cancel(job.id).status == "cancelling"
    done = runner.wait(job.id, timeout=5)
    assert done.status == "cancelled" and done.finished_at is not None and done.result is None


def test_cancel_also_stops_a_paused_job(runner: JobRunner):
    loop = Loop()
    runner.register("loop", loop)
    job = runner.submit("loop")
    loop.started.wait(5)
    runner.pause(job.id)
    wait_for(lambda: status(runner, job.id) == "paused", what="paused")
    runner.cancel(job.id)
    assert runner.wait(job.id, timeout=5).status == "cancelled"


def test_a_finished_job_cant_be_paused_or_cancelled(runner: JobRunner):
    runner.register("quick", lambda ctx: None)
    job = runner.wait(runner.submit("quick").id, timeout=5)
    with pytest.raises(JobError, match="done"):
        runner.pause(job.id)
    with pytest.raises(JobError, match="done"):
        runner.cancel(job.id)
    with pytest.raises(JobError, match="done"):
        runner.resume(job.id)


def test_unknown_jobs_and_kinds_are_errors(runner: JobRunner):
    with pytest.raises(JobNotFound):
        runner.get("nope")
    with pytest.raises(JobError, match="unknown job kind"):
        runner.submit("nope")


class Items:
    """A resumable job: handles items one by one and saves how far it got after each."""

    def __init__(self, n: int, stop_after: int | None = None):
        self.n, self.stop_after = n, stop_after
        self.handled: list[int] = []
        self.paused_here = threading.Event()

    def __call__(self, ctx: JobContext):
        start = (ctx.checkpoint or {}).get("next", 0)
        for i in range(start, self.n):
            if i == self.stop_after:
                self.paused_here.set()
                while True:                            # stand still until the server shuts down
                    ctx.check()
                    time.sleep(0.005)
            self.handled.append(i)
            ctx.save_checkpoint({"next": i + 1})
            ctx.progress(done=i + 1, total=self.n)
        return {"handled": len(self.handled)}


def test_after_a_restart_a_resumable_job_continues_where_it_stopped(db: Database):
    first = JobRunner(db)
    before = Items(5, stop_after=2)
    first.register("items", before, resumable=True)
    job = first.submit("items")
    assert before.paused_here.wait(5)
    first.shutdown(timeout=5)                           # the server stops
    assert first.get(job.id).status == "interrupted"

    second = JobRunner(db)                             # a new server process on the same database
    after = Items(5)
    second.register("items", after, resumable=True)
    second.recover()
    assert second.get(job.id).status == "interrupted"
    second.resume(job.id)
    done = second.wait(job.id, timeout=5)
    assert before.handled == [0, 1] and after.handled == [2, 3, 4]      # nothing done twice, nothing skipped
    assert (done.status, done.result, done.progress["percent"]) == ("done", {"handled": 3}, 100.0)


def test_jobs_a_crashed_server_left_running_show_as_interrupted(db: Database):
    with db.session() as s:                            # rows as a killed process leaves them
        s.add_all([Job(id="a", kind="transcribe", status="running", params={}, progress={"percent": 40}),
                   Job(id="b", kind="verify", status="paused", params={}, progress={}),
                   Job(id="c", kind="verify", status="cancelling", params={}, progress={}),
                   Job(id="d", kind="verify", status="done", params={}, progress={})])
    runner = JobRunner(db)
    runner.register("transcribe", lambda ctx: None)    # not resumable
    assert sorted(runner.recover()) == ["a", "b", "c"]
    assert [status(runner, i) for i in "abcd"] == ["interrupted", "interrupted", "cancelled", "done"]
    assert runner.get("a").progress == {"percent": 40}
    with pytest.raises(JobError, match="can't continue after a restart"):
        runner.resume("a")
    assert runner.cancel("a").status == "cancelled"


def test_list_is_newest_first_and_filters_by_lecture(runner: JobRunner, db: Database):
    with db.session() as s:
        s.add(Lecture(id=1, title="t", source_kind="text"))
    runner.register("quick", lambda ctx: None)
    a = runner.wait(runner.submit("quick", lecture_id=1).id, 5)
    b = runner.wait(runner.submit("quick").id, 5)
    assert [j.id for j in runner.list()] == [b.id, a.id]
    assert [j.id for j in runner.list(lecture_id=1)] == [a.id]


# ---- HTTP --------------------------------------------------------------------------------------------------


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as c:        # `with` runs the app's startup and shutdown
        yield c


def read_events(response) -> list[dict]:
    events = []
    for line in response.iter_lines():
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: "):]))
    return events


def test_the_progress_stream_sends_each_change_and_ends_with_the_job(client: TestClient):
    gate = threading.Event()

    def staged(ctx: JobContext):
        gate.wait(5)
        for stage in ("download", "audio", "transcribe"):
            ctx.progress(stage=stage, percent=100)
            time.sleep(0.02)
        return {"words": 3}

    jobs: JobRunner = client.app.state.jobs
    jobs.register("staged", staged)
    job = jobs.submit("staged")
    with client.stream("GET", f"/api/jobs/{job.id}/events") as response:
        assert response.headers["content-type"].startswith("text/event-stream")
        gate.set()
        events = read_events(response)
    assert events[0]["status"] in ("queued", "running")
    assert events[-1]["status"] == "done" and events[-1]["result"] == {"words": 3}
    stages = [e["progress"]["stage"] for e in events if e["progress"]]
    changes = [s for i, s in enumerate(stages) if i == 0 or s != stages[i - 1]]
    assert changes[-1] == "transcribe"
    assert changes == sorted(set(changes), key=changes.index)        # never backwards


def test_the_stream_of_a_finished_job_is_its_final_snapshot(client: TestClient):
    jobs: JobRunner = client.app.state.jobs
    jobs.register("quick", lambda ctx: 1)
    job = jobs.wait(jobs.submit("quick").id, 5)
    with client.stream("GET", f"/api/jobs/{job.id}/events") as response:
        events = read_events(response)
    assert [e["status"] for e in events] == ["done"]


def test_http_pause_resume_cancel_and_errors(client: TestClient):
    loop = Loop()
    jobs: JobRunner = client.app.state.jobs
    jobs.register("loop", loop)
    job = jobs.submit("loop")
    loop.started.wait(5)
    assert client.post(f"/api/jobs/{job.id}/pause").json()["status"] == "pausing"
    wait_for(lambda: client.get(f"/api/jobs/{job.id}").json()["status"] == "paused", what="paused")
    assert client.post(f"/api/jobs/{job.id}/resume").status_code == 200
    assert client.post(f"/api/jobs/{job.id}/cancel").json()["status"] == "cancelling"
    jobs.wait(job.id, 5)
    assert client.get(f"/api/jobs/{job.id}").json()["status"] == "cancelled"
    assert [j["id"] for j in client.get("/api/jobs").json()] == [job.id]
    assert client.post(f"/api/jobs/{job.id}/pause").status_code == 409
    assert client.get("/api/jobs/nope").status_code == 404
    assert client.get("/api/jobs/nope/events").status_code == 404


def test_restarting_the_app_marks_running_jobs_interrupted(settings):
    loop = Loop()
    with TestClient(create_app(settings)) as c:
        c.app.state.jobs.register("loop", loop)
        job = c.app.state.jobs.submit("loop")
        loop.started.wait(5)
    with TestClient(create_app(settings)) as c:        # a second start on the same data folder
        body = c.get(f"/api/jobs/{job.id}").json()
    assert body["status"] == "interrupted" and "server stopped" in body["error"]
