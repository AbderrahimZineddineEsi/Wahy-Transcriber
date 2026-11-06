import shutil

import pytest

from backend.laya_datagen.engine_bridge import EngineBridge, EngineBridgeError, REPO_ROOT, engine_options

needs_node = pytest.mark.skipif(
    not shutil.which("node") or not (REPO_ROOT / "data" / "corpus.json").exists(), reason="needs node and data/corpus.json"
)

TEXT = "قال الله تعالى وأما بنعمة ربك فحدث وقال النبي صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى ثم قال الشيخ هذا كلام عادي"


@pytest.fixture(scope="module")
def bridge():
    with EngineBridge() as b:
        yield b


@needs_node
@pytest.mark.parametrize("engine", ["v3", "v4"])
def test_detects_verse_and_hadith_with_app_envelope(bridge, engine):
    dets = bridge.detect(engine, TEXT.split())
    assert [d["sourceType"] for d in dets] == ["QURAN", "HADITH"]
    q = dets[0]
    assert q["displayRef"] == "الضحى: 11"
    st = q["envelope"]["state"]
    assert st["matched_span_in_lecture"] == "وأما بنعمة ربك فحدث"
    assert st["context_before"] == "قال الله تعالى"
    assert set(q["envelope"]["questions"]) == {"verdict", "boundary_status"}


@needs_node
def test_fingerprint_is_stable(bridge):
    assert bridge.fingerprint() == bridge.fingerprint()


@needs_node
def test_loose_profile_is_really_loose():
    with EngineBridge(extra_engine_files=["js/engine_v5.js"]) as b:
        assert b.detect("v5:loose", TEXT.split())


def test_engine_names_become_worker_options():
    assert engine_options("v4") == {"engine": "v4", "profile": "normal"}
    assert engine_options("v5:loose") == {"engine": "v5", "profile": "loose"}
    assert engine_options("v5/-variants", {"fix": {"variants": False}}) == \
        {"engine": "v5", "profile": "normal", "v5": {"fix": {"variants": False}}}


def test_another_engine_file_is_refused_with_a_reason():
    with pytest.raises(EngineBridgeError, match="copy the engine inside engine/src/"):
        EngineBridge(extra_engine_files=["js/engine_v5_saved.js"])
    with pytest.raises(EngineBridgeError, match="copy the engine inside engine/src/"):
        engine_options("v5@saved")
