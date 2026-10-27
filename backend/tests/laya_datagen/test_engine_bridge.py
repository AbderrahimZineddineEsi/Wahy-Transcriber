import shutil

import pytest

from backend.laya_datagen.engine_bridge import EngineBridge, REPO_ROOT

pytestmark = pytest.mark.skipif(
    not shutil.which("node") or not (REPO_ROOT / "data" / "corpus.json").exists(), reason="needs node and data/corpus.json"
)

TEXT = "قال الله تعالى وأما بنعمة ربك فحدث وقال النبي صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى ثم قال الشيخ هذا كلام عادي"


@pytest.fixture(scope="module")
def bridge():
    with EngineBridge() as b:
        yield b


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


def test_fingerprint_is_stable(bridge):
    assert bridge.fingerprint() == bridge.fingerprint()


def test_loose_profile_is_really_loose():
    # the harness must build v5:loose the app's way (wahyEngine = "v5:loose"); it raises if the profile did not apply
    with EngineBridge(extra_engine_files=["js/engine_v5.js"]) as b:
        assert b.detect("v5:loose", TEXT.split())
