"""Transcription: the recognisers (Groq over a fake HTTP server, faster-whisper through the real GPU owner with a
fake model), the fallback chain, the audio code (real ffmpeg), the quality check, and the whole thing through the
API with a fake ASR and a fake YouTube downloader. One live test only runs with --live."""

from __future__ import annotations

import json
import time
from types import SimpleNamespace

import httpx
import pytest
from fakes import FakeAsr, FakeYoutube, make_audio, sample_words
from helpers import wait_for
from pydantic import SecretStr

from wahy.core.gpu import GpuOwner
from wahy.core.jobs import JobCancelled
from wahy.features.lectures.parsing import TimedWord
from wahy.features.transcription import audio as audio_module
from wahy.features.transcription.audio import AudioTools, load_wav_array
from wahy.features.transcription.backends import (
    AsrError,
    GroqBackend,
    LocalWhisperBackend,
    OutOfGpuMemory,
    RawWord,
)
from wahy.features.transcription.quality import check_transcript
from wahy.features.transcription.service import (
    GROQ,
    LOCAL_SMALL,
    LOCAL_TURBO,
    SPECIALIZED,
    normalise_words,
)

FINAL = ("done", "failed", "cancelled", "interrupted")


# ---- the audio code, with real ffmpeg --------------------------------------------------------------------------

def test_prepare_extracts_16k_mono_samples_and_the_duration(tmp_path):
    src = make_audio(tmp_path / "in.mp3", seconds=2)
    prepared = AudioTools().prepare(src, tmp_path / "work")
    assert prepared.duration_s == pytest.approx(2.0, abs=0.1)
    samples = prepared.array()
    assert samples.dtype.name == "float32" and len(samples) == pytest.approx(32000, abs=1600)
    assert 0.1 < abs(samples).max() <= 1.0              # a sine, not silence
    assert load_wav_array(prepared.wav_path).shape == samples.shape


def test_a_file_that_is_not_media_gives_a_clear_error(tmp_path):
    bad = tmp_path / "x.mp4"
    bad.write_bytes(b"not a video")
    with pytest.raises(audio_module.AudioError, match="ffmpeg failed"):
        AudioTools().prepare(bad, tmp_path / "work")


def test_a_cancelled_job_kills_the_child_process_instead_of_waiting_for_it():
    calls = []

    def check():
        calls.append(1)
        if len(calls) >= 3:
            raise JobCancelled()
    started = time.monotonic()
    with pytest.raises(JobCancelled):
        audio_module._run(["sleep", "30"], check)
    assert time.monotonic() - started < 5


def test_a_cancelled_job_does_not_even_start_ffmpeg(tmp_path):
    def check():
        raise JobCancelled()
    with pytest.raises(JobCancelled):
        AudioTools().prepare(make_audio(tmp_path / "in.wav", seconds=1), tmp_path / "work", check)
    assert not (tmp_path / "work" / "audio_16k.wav").exists()


def test_long_audio_is_cut_for_groq_with_offsets_that_add_up(tmp_path, monkeypatch):
    monkeypatch.setattr(audio_module, "GROQ_MAX_CHUNK_S", 1)        # pretend 1 second is the limit
    monkeypatch.setattr(audio_module, "GROQ_MIN_PIECE_S", 1)
    prepared = AudioTools().prepare(make_audio(tmp_path / "in.wav", seconds=4), tmp_path / "work")
    chunks = prepared.groq_chunks()
    assert len(chunks) >= 2
    assert chunks[0].offset_s == 0.0
    for before, after in zip(chunks, chunks[1:], strict=False):
        assert after.offset_s == pytest.approx(before.offset_s + before.duration_s, abs=0.01)
    assert sum(c.duration_s for c in chunks) == pytest.approx(prepared.duration_s, abs=0.3)


def test_short_audio_is_one_groq_chunk(tmp_path):
    prepared = AudioTools().prepare(make_audio(tmp_path / "in.wav", seconds=2), tmp_path / "work")
    assert [(c.offset_s, c.path.suffix) for c in prepared.groq_chunks()] == [(0.0, ".mp3")]


# ---- Groq, over a fake HTTP server -----------------------------------------------------------------------------

class FakeAudio:
    """Just what a recogniser needs from PreparedAudio."""

    def __init__(self, tmp_path, offsets=(0.0,)):
        self.duration_s = 10.0
        self._chunks = []
        for i, offset in enumerate(offsets):
            path = tmp_path / f"c{i}.mp3"
            path.write_bytes(b"mp3")
            self._chunks.append(SimpleNamespace(path=path, offset_s=offset, duration_s=5.0))

    def groq_chunks(self):
        return self._chunks


def groq(handler, key="gsk_test", **kw):
    return GroqBackend(lambda: key, transport=httpx.MockTransport(handler), sleep=lambda _s: None, **kw)


def test_groq_words_are_put_back_on_the_lectures_clock(tmp_path):
    requests = []

    def handler(request):
        requests.append(request)
        n = len(requests)
        return httpx.Response(200, json={"words": [{"word": f" w{n} ", "start": 0.5, "end": 1.0}]})

    out = []
    words = groq(handler).transcribe(FakeAudio(tmp_path, offsets=(0.0, 5.0)), on_percent=out.append,
                                     check=lambda: None)
    assert words == [RawWord("w1", 0.5, 1.0), RawWord("w2", 5.5, 6.0)]        # second chunk starts at 5 s
    assert out == [50.0, 100.0]
    assert requests[0].headers["authorization"] == "Bearer gsk_test"
    body = requests[0].content
    assert b"whisper-large-v3-turbo" in body and b"timestamp_granularities[]" in body


def test_groq_without_word_times_spreads_the_segment_words(tmp_path):
    def handler(_request):
        return httpx.Response(200, json={"segments": [{"text": "واحد اثنان", "start": 2.0, "end": 4.0}]})

    words = groq(handler).transcribe(FakeAudio(tmp_path), on_percent=lambda _p: None, check=lambda: None)
    assert words == [RawWord("واحد", 2.0, 3.0), RawWord("اثنان", 3.0, 4.0)]


def test_groq_without_a_key_fails_at_once(tmp_path):
    called = []
    backend = groq(lambda r: called.append(r) or httpx.Response(200, json={}), key=None)
    with pytest.raises(AsrError, match="no Groq API key"):
        backend.transcribe(FakeAudio(tmp_path), on_percent=lambda _p: None, check=lambda: None)
    assert not called


def test_groq_retries_a_busy_server_but_not_a_wrong_key(tmp_path):
    answers = [httpx.Response(429, headers={"retry-after": "1"}, text="slow down"),
               httpx.Response(200, json={"words": [{"word": "نعم", "start": 0, "end": 1}]})]
    words = groq(lambda _r: answers.pop(0)).transcribe(FakeAudio(tmp_path), on_percent=lambda _p: None,
                                                       check=lambda: None)
    assert [w.text for w in words] == ["نعم"] and not answers

    calls = []

    def unauthorized(request):
        calls.append(request)
        return httpx.Response(401, text="invalid api key")

    with pytest.raises(AsrError, match="HTTP 401"):
        groq(unauthorized).transcribe(FakeAudio(tmp_path), on_percent=lambda _p: None, check=lambda: None)
    assert len(calls) == 1                                          # no retry: the key is wrong


def test_groq_gives_up_after_its_attempts_and_reports_the_last_error(tmp_path):
    calls = []

    def always_busy(request):
        calls.append(request)
        return httpx.Response(503, text="down")

    with pytest.raises(AsrError, match="HTTP 503"):
        groq(always_busy, attempts=3).transcribe(FakeAudio(tmp_path), on_percent=lambda _p: None,
                                                 check=lambda: None)
    assert len(calls) == 3


def test_a_cancelled_job_is_not_turned_into_a_groq_error(tmp_path):
    def check():
        raise JobCancelled()
    with pytest.raises(JobCancelled):
        groq(lambda _r: httpx.Response(200, json={})).transcribe(
            FakeAudio(tmp_path), on_percent=lambda _p: None, check=check)


# ---- local Whisper, through the real GPU owner -----------------------------------------------------------------

class FakeWhisperModel:
    """What faster-whisper's WhisperModel looks like to the backend."""

    def __init__(self, segments=None, error=None):
        self.segments, self.error, self.seen = segments, error, None

    def transcribe(self, samples, **options):
        self.seen = (samples, options)
        if self.error:
            raise self.error
        return iter(self.segments), SimpleNamespace()


def word(text, start, end):
    return SimpleNamespace(word=f" {text}", start=start, end=end)


def local_backend(model, freed=None):
    gpu = GpuOwner(free_memory=lambda: freed.append(1) if freed is not None else None)
    gpu.register("whisper:small", load=lambda: model)
    return gpu, LocalWhisperBackend(gpu, id=LOCAL_SMALL, label="local:small", gpu_key="whisper:small")


def prepared(tmp_path, seconds=2.0):
    return AudioTools().prepare(make_audio(tmp_path / "in.wav", seconds), tmp_path / "work")


def test_local_whisper_gets_decoded_samples_not_a_path_and_returns_timed_words(tmp_path):
    model = FakeWhisperModel(segments=[
        SimpleNamespace(start=0.0, end=1.0, text="x", words=[word("بسم", 0.0, 0.4), word("الله", 0.4, 0.9)]),
        SimpleNamespace(start=1.0, end=2.0, text="الرحمن الرحيم", words=None)])
    gpu, backend = local_backend(model)
    percents = []
    words = backend.transcribe(prepared(tmp_path), on_percent=percents.append, check=lambda: None)

    samples, options = model.seen
    assert hasattr(samples, "dtype") and not isinstance(samples, str)          # an array, not a file path
    assert options["language"] == "ar" and options["word_timestamps"] is True
    assert [w.text for w in words] == ["بسم", "الله", "الرحمن", "الرحيم"]
    assert words[2].start == 1.0 and words[3].end == 2.0                        # words of a bare segment: spread
    assert percents[-1] == pytest.approx(100, abs=10)
    assert gpu.status().resident == "whisper:small"                             # stays loaded for the next job


def test_out_of_memory_frees_the_gpu_and_lets_the_chain_fall_back(tmp_path):
    freed = []
    model = FakeWhisperModel(error=RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB"))
    gpu, backend = local_backend(model, freed)
    with pytest.raises(OutOfGpuMemory):
        backend.transcribe(prepared(tmp_path), on_percent=lambda _p: None, check=lambda: None)
    assert gpu.status().resident is None and freed                              # nothing half-loaded stays


def test_a_missing_library_says_how_to_install_it(tmp_path):
    gpu = GpuOwner(free_memory=lambda: None)

    def load():
        raise ImportError("no faster_whisper", name="faster_whisper")
    gpu.register("whisper:small", load=load)
    backend = LocalWhisperBackend(gpu, id=LOCAL_SMALL, label="local:small", gpu_key="whisper:small")
    with pytest.raises(AsrError, match="uv sync --extra local-asr"):
        backend.transcribe(prepared(tmp_path), on_percent=lambda _p: None, check=lambda: None)


# ---- how faster-whisper is loaded ------------------------------------------------------------------------------

@pytest.fixture
def fake_faster_whisper(monkeypatch):
    """A `faster_whisper` module whose WhisperModel records its device and can refuse CUDA."""
    import sys
    import types

    from wahy.features.transcription import backends
    made = []

    class WhisperModel:
        refuse_cuda = False

        def __init__(self, size, device, compute_type, cpu_threads):
            if device == "cuda" and WhisperModel.refuse_cuda:
                raise RuntimeError("Library libcublas.so.12 is not found or cannot be loaded")
            made.append((size, device, compute_type))

    module = types.ModuleType("faster_whisper")
    module.WhisperModel = WhisperModel
    monkeypatch.setitem(sys.modules, "faster_whisper", module)
    monkeypatch.setattr(backends, "_preload_cuda_libraries", lambda: None)
    return SimpleNamespace(model=WhisperModel, made=made, backends=backends)


def test_whisper_uses_cuda_in_int8_when_there_is_a_gpu(fake_faster_whisper, monkeypatch):
    monkeypatch.setattr(fake_faster_whisper.backends, "_cuda_available", lambda: True)
    fake_faster_whisper.backends._load_faster_whisper("large-v3-turbo")
    assert fake_faster_whisper.made == [("large-v3-turbo", "cuda", "int8")]


def test_whisper_uses_the_cpu_when_there_is_no_gpu(fake_faster_whisper, monkeypatch):
    monkeypatch.setattr(fake_faster_whisper.backends, "_cuda_available", lambda: False)
    fake_faster_whisper.backends._load_faster_whisper("small")
    assert fake_faster_whisper.made == [("small", "cpu", "int8")]


def test_a_broken_cuda_setup_runs_small_on_the_cpu_but_fails_turbo_so_the_chain_moves_on(fake_faster_whisper,
                                                                                          monkeypatch):
    monkeypatch.setattr(fake_faster_whisper.backends, "_cuda_available", lambda: True)
    fake_faster_whisper.model.refuse_cuda = True
    fake_faster_whisper.backends._load_faster_whisper("small")
    assert fake_faster_whisper.made == [("small", "cpu", "int8")]
    with pytest.raises(RuntimeError, match="libcublas"):
        fake_faster_whisper.backends._load_faster_whisper("large-v3-turbo")


# ---- words and the quality check -------------------------------------------------------------------------------

def test_normalise_drops_empty_words_and_gives_every_word_some_duration():
    raw = [RawWord("  ", 0, 1), RawWord(" نعم ", 1.234, 1.236), RawWord("لا", 2.0, 0.0)]
    # an end of 0 means "missing" (as in the old code): the word gets a quarter of a second
    assert normalise_words(raw) == [TimedWord("نعم", 1.23, 1.27), TimedWord("لا", 2.0, 2.25)]


def words_from(text):
    return [TimedWord(t, i * 0.5, i * 0.5 + 0.4) for i, t in enumerate(text.split())]


def test_a_run_of_english_words_is_flagged_but_one_term_is_not():
    ok = words_from("قال النبي WhatsApp في الحديث")
    assert check_transcript(ok) == []
    bad = words_from("ثم قال Thank you for watching الحمد لله")
    [w] = check_transcript(bad)
    assert (w.kind, w.start_idx, w.end_idx, w.sample) == ("latin_run", 2, 5, "Thank you for watching")
    assert (w.start_s, w.end_s) == (1.0, 2.9)


def test_repeating_words_and_phrases_are_flagged():
    [w] = check_transcript(words_from("قال " + "نعم " * 7 + "ثم سكت"))
    assert (w.kind, w.start_idx, w.end_idx, w.repeats) == ("repetition", 1, 7, 7)
    [p] = check_transcript(words_from("بدأ " + "الحمد لله " * 4 + "انتهى"))
    assert (p.start_idx, p.end_idx, p.repeats) == (1, 8, 4)
    assert check_transcript(words_from("نعم نعم نعم ثم لا لا")) == []          # ordinary emphasis


def test_repetition_ignores_diacritics_and_punctuation():
    text = "نَعَمْ، " + "نعم " * 5
    [w] = check_transcript(words_from(text))
    assert w.repeats == 6


def test_clean_text_has_no_warnings():
    assert check_transcript(words_from("إن الحمد لله نحمده ونستعينه ونستغفره")) == []
    assert check_transcript([]) == []


# ---- the whole thing through the API -------------------------------------------------------------------------

@pytest.fixture
def api(client, tmp_path):
    """The app with a fake recogniser for every model and a fake YouTube downloader."""
    state = client.app.state
    asr = {GROQ: FakeAsr(GROQ, "fake:groq"), SPECIALIZED: FakeAsr(SPECIALIZED, "fake:special"),
           LOCAL_TURBO: FakeAsr(LOCAL_TURBO, "fake:turbo"), LOCAL_SMALL: FakeAsr(LOCAL_SMALL, "fake:small")}
    state.transcription.backends = asr
    state.lectures.media.fetcher = FakeYoutube(make_audio(tmp_path / "yt.mp3", seconds=3))
    client.asr = asr
    client.youtube = state.lectures.media.fetcher
    return client


def finish(client, job_id, timeout=15.0):
    wait_for(lambda: client.get(f"/api/jobs/{job_id}").json()["status"] in FINAL, timeout, "the job to end")
    return client.get(f"/api/jobs/{job_id}").json()


def test_an_uploaded_file_becomes_a_lecture_with_timed_words(api, tmp_path):
    audio = make_audio(tmp_path / "khutba.mp3", seconds=3).read_bytes()
    r = api.post("/api/transcriptions/upload", files={"file": ("khutba.mp3", audio)},
                 data={"model": LOCAL_SMALL})
    assert r.status_code == 202
    started = r.json()
    assert started["lecture"]["title"] == "khutba" and started["lecture"]["word_count"] == 0

    job = finish(api, started["job"]["id"])
    assert job["status"] == "done", job["error"]
    assert job["result"]["model_used"] == "fake:small" and job["result"]["fallback"] is None
    assert job["result"]["word_count"] == 6 and job["result"]["duration_s"] == pytest.approx(3.0, abs=0.1)
    assert [job["progress"]["stage"], job["progress"]["percent"]] == ["save", 100]

    lecture = api.get(f"/api/lectures/{started['lecture']['id']}").json()
    assert lecture["transcription_model"] == "fake:small" and lecture["has_media"]
    assert lecture["words"][1] == {"idx": 1, "text": "كلمة1", "start": 0.5, "end": 0.9}
    assert api.get(f"/api/lectures/{lecture['id']}/media").status_code == 200
    assert not list((api.app.state.settings.media_dir / "tmp").glob("*"))      # the work folder is gone


def test_a_youtube_link_shows_progress_and_ends_with_timed_words(api):
    r = api.post("/api/transcriptions/youtube", json={"url": "https://youtu.be/abc", "model": GROQ})
    assert r.status_code == 202
    started = r.json()
    assert started["lecture"]["source_kind"] == "youtube"

    stages = []
    with api.stream("GET", f"/api/jobs/{started['job']['id']}/events") as stream:
        for line in stream.iter_lines():
            if line.startswith("data:"):
                snap = json.loads(line[5:])
                stage = snap["progress"].get("stage")
                if stage and (not stages or stages[-1] != stage):
                    stages.append(stage)
    order = ["download", "audio", "transcribe", "save"]
    assert stages == sorted(stages, key=order.index) and stages[-1] == "save"       # in order, to the end

    job = api.get(f"/api/jobs/{started['job']['id']}").json()
    assert job["status"] == "done" and job["result"]["from_cache"] is False
    lecture = api.get(f"/api/lectures/{started['lecture']['id']}").json()
    assert lecture["title"] == "خطبة الجمعة"                       # took the video's title
    assert lecture["word_count"] == 6 and lecture["has_media"] and lecture["source_url"] == "https://youtu.be/abc"


def test_the_same_link_twice_downloads_once(api):
    first = api.post("/api/transcriptions/youtube", json={"url": "https://youtu.be/abc", "model": GROQ}).json()
    assert finish(api, first["job"]["id"])["result"]["from_cache"] is False
    second = api.post("/api/transcriptions/youtube", json={"url": "https://youtu.be/abc", "model": GROQ}).json()
    done = finish(api, second["job"]["id"])
    assert done["status"] == "done" and done["result"]["from_cache"] is True
    assert api.youtube.calls == ["https://youtu.be/abc"]                           # one download only


def test_a_wrong_groq_key_falls_back_to_local_whisper_and_says_so(api, tmp_path):
    api.asr[GROQ].error = "Groq rejected the request (HTTP 401: invalid api key)"
    audio = make_audio(tmp_path / "a.mp3").read_bytes()
    started = api.post("/api/transcriptions/upload", files={"file": ("a.mp3", audio)},
                       data={"model": GROQ, "auto_fallback": "true"}).json()
    job = finish(api, started["job"]["id"])
    assert job["status"] == "done"
    assert job["result"]["model_used"] == "fake:turbo" and job["result"]["requested_model"] == GROQ
    assert "HTTP 401" in job["result"]["fallback"]["reason"]
    assert api.get(f"/api/lectures/{started['lecture']['id']}").json()["transcription_model"] == "fake:turbo"


def test_when_turbo_runs_out_of_memory_the_small_model_takes_over(api, tmp_path):
    api.asr[GROQ].error = "no Groq API key"
    api.asr[LOCAL_TURBO].error = "the GPU ran out of memory"
    started = api.post("/api/transcriptions/upload", files={"file": ("a.mp3", make_audio(tmp_path / "a.mp3").read_bytes())},
                       data={"model": GROQ}).json()
    job = finish(api, started["job"]["id"])
    assert job["result"]["model_used"] == "fake:small"
    assert job["result"]["fallback"]["reason"] == "no Groq API key"              # the first failure is reported


def test_without_fallback_the_failure_ends_the_job_and_nothing_else_runs(api, tmp_path):
    api.asr[GROQ].error = "no Groq API key"
    started = api.post("/api/transcriptions/upload", files={"file": ("a.mp3", make_audio(tmp_path / "a.mp3").read_bytes())},
                       data={"model": GROQ, "auto_fallback": "false"}).json()
    job = finish(api, started["job"]["id"])
    assert job["status"] == "failed" and "no Groq API key" in job["error"]
    assert api.asr[LOCAL_TURBO].calls == 0 and api.asr[LOCAL_SMALL].calls == 0


def test_when_every_model_fails_the_first_error_is_reported(api, tmp_path):
    for backend in api.asr.values():
        backend.error = f"{backend.id} broke"
    started = api.post("/api/transcriptions/upload", files={"file": ("a.mp3", make_audio(tmp_path / "a.mp3").read_bytes())},
                       data={"model": SPECIALIZED}).json()
    job = finish(api, started["job"]["id"])
    assert job["status"] == "failed" and "specialized-whisper-large-v3-ar broke" in job["error"]
    assert [api.asr[m].calls for m in (SPECIALIZED, GROQ, LOCAL_SMALL, LOCAL_TURBO)] == [1, 1, 1, 0]


def test_silence_ends_the_job_with_a_clear_error(api, tmp_path):
    api.asr[LOCAL_SMALL].words = []
    started = api.post("/api/transcriptions/upload", files={"file": ("a.mp3", make_audio(tmp_path / "a.mp3").read_bytes())},
                       data={"model": LOCAL_SMALL}).json()
    job = finish(api, started["job"]["id"])
    assert job["status"] == "failed" and "no speech" in job["error"]


def test_quality_warnings_come_with_the_result(api, tmp_path):
    api.asr[LOCAL_SMALL].words = ([RawWord("قال", 0, 0.4)]
                                  + [RawWord(w, 1 + i, 1.4 + i) for i, w in enumerate("Thank you for watching".split())])
    started = api.post("/api/transcriptions/upload", files={"file": ("a.mp3", make_audio(tmp_path / "a.mp3").read_bytes())},
                       data={"model": LOCAL_SMALL}).json()
    [warning] = finish(api, started["job"]["id"])["result"]["warnings"]
    assert warning["kind"] == "latin_run" and warning["sample"] == "Thank you for watching"


def test_a_job_can_be_cancelled_while_transcribing(api, tmp_path):
    api.asr[LOCAL_SMALL].steps, api.asr[LOCAL_SMALL].step_delay = 200, 0.05
    started = api.post("/api/transcriptions/upload", files={"file": ("a.mp3", make_audio(tmp_path / "a.mp3").read_bytes())},
                       data={"model": LOCAL_SMALL}).json()
    job_id = started["job"]["id"]
    wait_for(lambda: api.asr[LOCAL_SMALL].calls == 1, 10, "the recogniser to start")
    api.post(f"/api/jobs/{job_id}/cancel")
    assert finish(api, job_id)["status"] == "cancelled"
    assert api.get(f"/api/lectures/{started['lecture']['id']}").json()["word_count"] == 0
    assert not list((api.app.state.settings.media_dir / "tmp").glob("*"))


def test_transcribing_again_replaces_the_words_of_a_lecture_with_media(api, tmp_path):
    lecture = api.post("/api/lectures", json={"text": "نص قديم"}).json()
    no_media = api.post(f"/api/lectures/{lecture['id']}/transcribe", json={})
    assert no_media.status_code == 409                                               # nothing to transcribe
    api.put(f"/api/lectures/{lecture['id']}/media", files={"file": ("a.mp3", make_audio(tmp_path / "a.mp3").read_bytes())})
    r = api.post(f"/api/lectures/{lecture['id']}/transcribe", json={"model": LOCAL_SMALL})
    assert r.status_code == 202
    assert finish(api, r.json()["job"]["id"])["status"] == "done"
    assert [w["text"] for w in api.get(f"/api/lectures/{lecture['id']}").json()["words"]][0] == "كلمة0"


def test_bad_requests(api, tmp_path):
    assert api.post("/api/transcriptions/youtube", json={"url": "file:///etc/passwd"}).status_code == 422
    assert api.post("/api/transcriptions/youtube", json={"url": "not a url"}).status_code == 422
    assert api.post("/api/transcriptions/youtube", json={"url": "https://youtu.be/x", "model": "gpt"}).status_code == 422
    assert api.post("/api/transcriptions/upload", files={"file": ("a.txt", b"x")}).status_code == 400
    assert api.post("/api/lectures/999/transcribe", json={}).status_code == 404


def test_models_list_says_what_is_available(api):
    models = {m["id"]: m for m in api.get("/api/transcription/models").json()}
    assert set(models) == {GROQ, SPECIALIZED, LOCAL_TURBO, LOCAL_SMALL}
    assert models[GROQ]["available"] is False and models[GROQ]["reason"] == "no GROQ_API_KEY"
    assert models[LOCAL_SMALL]["default"] is True                       # no Groq key: the safe local model
    api.app.state.settings.groq_api_key = SecretStr("gsk_x")
    models = {m["id"]: m for m in api.get("/api/transcription/models").json()}
    assert models[GROQ]["available"] and models[GROQ]["default"] and not models[LOCAL_SMALL]["default"]


def test_sample_words_helper_is_what_the_fake_returns():
    assert [w.text for w in sample_words(2)] == ["كلمة0", "كلمة1"]


# ---- live: only with --live ------------------------------------------------------------------------------------

@pytest.mark.live
def test_live_youtube_download_and_local_small_whisper(client, tmp_path):
    """Needs the network and the local-asr extra. Set WAHY_LIVE_URL to a short video (default: a ~1 minute clip)."""
    import os
    url = os.environ.get("WAHY_LIVE_URL", "https://www.youtube.com/watch?v=jNQXAC9IVRw")
    r = client.post("/api/transcriptions/youtube", json={"url": url, "model": LOCAL_SMALL})
    job = finish(client, r.json()["job"]["id"], timeout=600)
    assert job["status"] == "done", job["error"]
    lecture = client.get(f"/api/lectures/{r.json()['lecture']['id']}").json()
    assert lecture["word_count"] > 0 and lecture["words"][-1]["end"] > 0
