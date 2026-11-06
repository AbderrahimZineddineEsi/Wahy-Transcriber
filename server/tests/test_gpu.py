"""The GPU owner with fake models: one model resident at a time, callers wait their turn."""

import threading
import time

import pytest

from tests.helpers import wait_for
from wahy.core.gpu import GpuError, GpuOwner
from wahy.core.jobs import JobContext, JobRunner


class FakeGpu:
    """Registers fake models on an owner and records what happens on the "GPU"."""

    def __init__(self, owner: GpuOwner, names=("whisper", "laya")):
        self.log: list[str] = []
        self.loaded: set[str] = set()
        self.max_loaded = 0
        self.frees = 0
        for name in names:
            owner.register(name, load=lambda n=name: self._load(n), unload=self._unload)

    def _load(self, name: str) -> dict:
        self.log.append(f"load {name}")
        self.loaded.add(name)
        self.max_loaded = max(self.max_loaded, len(self.loaded))
        return {"name": name}

    def _unload(self, model: dict) -> None:
        self.log.append(f"unload {model['name']}")
        self.loaded.discard(model["name"])


@pytest.fixture
def gpu():
    return GpuOwner(poll_s=0.01)


def test_a_model_stays_resident_for_the_next_caller(gpu: GpuOwner):
    fake = FakeGpu(gpu)
    with gpu.use("whisper") as m:
        assert m == {"name": "whisper"}
    with gpu.use("whisper"):
        pass
    assert fake.log == ["load whisper"]
    assert gpu.status().resident == "whisper" and gpu.status().in_use is None


def test_asking_for_another_model_unloads_the_first(gpu: GpuOwner):
    freed = []
    gpu = GpuOwner(free_memory=lambda: freed.append(1), poll_s=0.01)
    fake = FakeGpu(gpu)
    with gpu.use("whisper"):
        pass
    with gpu.use("laya") as m:
        assert m["name"] == "laya"
    assert fake.log == ["load whisper", "unload whisper", "load laya"]
    assert freed and fake.max_loaded == 1


def test_a_second_caller_waits_until_the_first_is_done(gpu: GpuOwner):
    fake = FakeGpu(gpu)
    inside, release = threading.Event(), threading.Event()
    order = []

    def first():
        with gpu.use("whisper"):
            inside.set()
            release.wait(5)
            order.append("whisper done")

    def second():
        with gpu.use("laya"):
            order.append("laya starts")

    a = threading.Thread(target=first)
    a.start()
    inside.wait(5)
    b = threading.Thread(target=second)
    b.start()
    wait_for(lambda: gpu.status().waiting == ["laya"], what="laya waiting")
    assert gpu.status().in_use == "whisper"
    release.set()
    a.join(5)
    b.join(5)
    assert order == ["whisper done", "laya starts"]
    assert fake.log == ["load whisper", "unload whisper", "load laya"]
    assert gpu.status().waiting == []


def test_many_threads_never_have_two_models_on_the_gpu(gpu: GpuOwner):
    fake = FakeGpu(gpu, names=("whisper", "laya", "specialized"))
    users = [0]
    max_users = [0]
    lock = threading.Lock()

    def work(name):
        for _ in range(5):
            with gpu.use(name):
                with lock:
                    users[0] += 1
                    max_users[0] = max(max_users[0], users[0])
                time.sleep(0.001)
                with lock:
                    users[0] -= 1

    threads = [threading.Thread(target=work, args=(n,)) for n in ("whisper", "laya", "specialized") * 3]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert max_users[0] == 1 and fake.max_loaded == 1


def test_a_waiting_caller_can_give_up(gpu: GpuOwner):
    FakeGpu(gpu)
    inside, release = threading.Event(), threading.Event()
    holder = threading.Thread(target=lambda: _hold(gpu, inside, release))
    holder.start()
    inside.wait(5)
    stop = threading.Event()

    def should_stop():
        if stop.is_set():
            raise TimeoutError("gave up")

    errors = []

    def waiter():
        try:
            with gpu.use("laya", should_stop=should_stop):
                errors.append("got the GPU")
        except TimeoutError as e:
            errors.append(str(e))

    w = threading.Thread(target=waiter)
    w.start()
    wait_for(lambda: gpu.status().waiting == ["laya"], what="waiting")
    stop.set()
    w.join(5)
    assert errors == ["gave up"] and gpu.status().waiting == []
    release.set()
    holder.join(5)
    assert gpu.status().resident == "whisper"         # the holder was not disturbed


def _hold(gpu, inside, release):
    with gpu.use("whisper"):
        inside.set()
        release.wait(5)


def test_a_job_waiting_for_the_gpu_can_be_cancelled(gpu: GpuOwner, runner: JobRunner):
    FakeGpu(gpu)
    inside, release = threading.Event(), threading.Event()
    holder = threading.Thread(target=lambda: _hold(gpu, inside, release))
    holder.start()
    inside.wait(5)

    def verify(ctx: JobContext):
        with gpu.use("laya", should_stop=ctx.check):
            return "ran"

    runner.register("verify", verify)
    job = runner.submit("verify")
    wait_for(lambda: gpu.status().waiting == ["laya"], what="job waiting for the GPU")
    runner.cancel(job.id)
    assert runner.wait(job.id, 5).status == "cancelled"
    release.set()
    holder.join(5)


def test_a_model_that_fails_to_load_leaves_the_gpu_free(gpu: GpuOwner):
    fake = FakeGpu(gpu)

    def broken():
        raise RuntimeError("CUDA out of memory")

    gpu.register("big", load=broken)
    with gpu.use("whisper"):
        pass
    with pytest.raises(RuntimeError, match="out of memory"), gpu.use("big"):
        pass
    assert gpu.status().resident is None and gpu.status().in_use is None   # whisper was unloaded first
    with gpu.use("laya"):
        pass
    assert fake.log == ["load whisper", "unload whisper", "load laya"]


def test_unload_frees_the_gpu(gpu: GpuOwner):
    fake = FakeGpu(gpu)
    gpu.load("laya")
    assert gpu.status().resident == "laya"
    assert gpu.unload() == "laya"
    assert gpu.status().resident is None and fake.loaded == set()
    assert gpu.unload() is None


def test_using_the_gpu_twice_in_one_thread_is_an_error_not_a_deadlock(gpu: GpuOwner):
    FakeGpu(gpu)
    with gpu.use("whisper"), pytest.raises(GpuError, match="already uses the GPU"), gpu.use("laya"):
        pass
    with pytest.raises(GpuError, match="unknown model"), gpu.use("nope"):
        pass
