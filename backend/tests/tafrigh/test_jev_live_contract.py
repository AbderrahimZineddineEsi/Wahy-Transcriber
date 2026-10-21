"""JEV adapter against a mocked Decisions API, plus regressions for the runaway split loop and jumping progress."""

import json

import httpx
import pytest

from backend.tafrigh.adapters.jev_adapter import JEVAdapter, JEVAPIError
from backend.tafrigh.pipeline import TafrighModelError, TafrighPipeline
from backend.tafrigh.schemas import JEVRequestConfig, PipelineConfig

KEY = "sk-or-v1-" + "a" * 40


def jev_transport(answer_for, calls=None):
    """answer_for(question_key, options) -> choice. Mimics /api/alpha/decisions."""

    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        if calls is not None:
            calls.append(body)
        answers = {k: {"choice": answer_for(k, list(q["criteria"])), "confidence": 0.9} for k, q in body["questions"].items()}
        return httpx.Response(200, json={"answers": answers, "usage": {"cost": 0.00001, "input_tokens": 100}})

    return httpx.MockTransport(handler)


def make_pipeline(adapter, **cfg):
    config = PipelineConfig(processing_mode="per_sentence", model_candidate="jev_hybrid", **cfg)
    return TafrighPipeline(config, adapters={"jev": adapter})


def test_request_contract_matches_decisions_api():
    calls = []
    ad = JEVAdapter(api_key=KEY, transport=jev_transport(lambda k, o: o[0], calls), sleep_fn=lambda s: None)
    out = ad.predict_questions({"target_text": "x"}, {"tag": ["paragraph", "comment"], "hasTypo": ["true", "false"]})
    body = calls[0]
    assert body["model"] == "typesafe/jev-1.14" and body["state"] == {"target_text": "x"}
    assert body["questions"]["tag"]["type"] == "choice" and set(body["questions"]["tag"]["criteria"]) == {"paragraph", "comment"}
    assert out["answers"] == {"tag": "paragraph", "hasTypo": "true"}


def test_missing_key_is_a_clear_error_not_silent_garbage():
    ad = JEVAdapter(api_key="")
    ad.api_key = ""
    with pytest.raises(JEVAPIError) as e:
        ad.predict_questions({}, {"hasTypo": ["true", "false"]})
    assert e.value.status == 401


def test_invalid_choice_from_api_is_rejected():
    ad = JEVAdapter(api_key=KEY, transport=jev_transport(lambda k, o: "nonsense"), max_retries=0)
    with pytest.raises(JEVAPIError):
        ad.predict_questions({}, {"hasTypo": ["true", "false"]})


def test_missing_key_aborts_the_run_with_a_message():
    ad = JEVAdapter(api_key="")
    ad.api_key = ""
    with pytest.raises(TafrighModelError):
        make_pipeline(ad).run(raw_text="جملة أولى طويلة نوعا ما. جملة ثانية.")


def test_a_model_that_always_says_split_cannot_loop_forever():
    """Regression: every answer was options[0] == 'true', so needsSplitting was always true and sentences split into single words."""
    ad = JEVAdapter(api_key=KEY, transport=jev_transport(lambda k, o: "true" if k != "tag" else o[0]), sleep_fn=lambda s: None)
    text = "هذه جملة طويلة نسبيا فيها كلمات كثيرة جدا لنرى. وهذه جملة ثانية فيها كلمات كثيرة أيضا لنرى."
    res = make_pipeline(ad).run(raw_text=text)
    assert "".join(s.original_text for s in res.segments) == text
    assert len(res.segments) <= 12


def test_progress_never_goes_backwards():
    seen = []
    ad = JEVAdapter(api_key=KEY, transport=jev_transport(lambda k, o: "false" if k != "tag" else o[0]), sleep_fn=lambda s: None)
    pipe = make_pipeline(ad)
    pipe.on_progress = lambda done, total, msg, info: seen.append(100 * done / total)
    pipe.run(raw_text=". ".join(f"هذه الجملة رقم {n} وفيها كلمات كثيرة" for n in range(12)) + ".")
    assert len(seen) >= 10 and seen == sorted(seen) and seen[-1] < 100


def test_matn_option_is_withheld_when_no_matn_is_configured():
    calls = []
    ad = JEVAdapter(api_key=KEY, transport=jev_transport(lambda k, o: "false" if k != "tag" else o[0], calls), sleep_fn=lambda s: None)
    make_pipeline(ad).run(raw_text="بسم الله الرحمن الرحيم نبدأ الدرس.")
    tag_opts = [set(c["questions"]["tag"]["criteria"]) for c in calls if "tag" in c["questions"]]
    assert tag_opts and all("matn_section" not in o for o in tag_opts)


TWELVE = ". ".join(f"هذه الجملة رقم {n} وفيها كلمات كثيرة" for n in range(12)) + "."


def quiet_jev(calls=None):
    return JEVAdapter(api_key=KEY, transport=jev_transport(lambda k, o: "false" if k != "tag" else o[0], calls), sleep_fn=lambda s: None)


def test_range_run_classifies_only_the_chosen_sentences_but_shows_neighbours_as_context():
    calls = []
    res = make_pipeline(quiet_jev(calls)).run(raw_text=TWELVE, target_range=(4, 7))
    assert [s.id for s in res.segments] == ["seg_0005", "seg_0006", "seg_0007"]
    first_tag_call = next(c for c in calls if "tag" in c["questions"])
    assert first_tag_call["state"]["context_before"], "sentence 5 must still see sentences 2-4 as context"


def test_cancel_stops_between_sentences_and_returns_what_was_done():
    pipe = make_pipeline(quiet_jev())
    state = {"n": 0}

    def control():
        state["n"] += 1
        return "cancel" if state["n"] > 3 else "run"

    pipe.control = control
    res = pipe.run(raw_text=TWELVE)
    assert len(res.segments) == 3 and res.run_manifest["cancelled"] is True


def test_pause_holds_the_run_until_resumed():
    import backend.tafrigh.pipeline as P

    pipe = make_pipeline(quiet_jev())
    seq = iter(["run", "pause", "pause", "run"] + ["run"] * 50)
    pipe.control = lambda: next(seq)
    seen = []
    pipe.on_progress = lambda d, t, m, info: seen.append(info["paused"])
    orig_sleep = P.time.sleep
    P.time.sleep = lambda s: None
    try:
        res = pipe.run(raw_text=TWELVE)
    finally:
        P.time.sleep = orig_sleep
    assert len(res.segments) == 12 and True in seen and not res.run_manifest["cancelled"]


def test_progress_details_are_reported():
    pipe = make_pipeline(quiet_jev())
    last = {}
    pipe.on_progress = lambda d, t, m, info: last.update(info)
    pipe.run(raw_text=TWELVE)
    for key in ("elapsed_sec", "eta_sec", "model_calls", "cost_usd", "errors", "tags", "current"):
        assert key in last
    assert last["model_calls"] > 0 and last["current"]["text"]


def test_confidence_is_the_probability_of_the_chosen_option_not_jevs_margin():
    """JEV's 'confidence' is the top-2 margin (0.56 - 0.44 = 0.12); showing it as certainty looked like '56%-sure paragraph = 12%'."""

    def handler(req):
        return httpx.Response(200, json={"answers": {"tag": {
            "choice": "paragraph", "confidence": 0.12, "probabilities": {"paragraph": 0.56, "continuation": 0.44}}}})

    ad = JEVAdapter(api_key=KEY, transport=httpx.MockTransport(handler))
    out = ad.predict_questions({}, {"tag": ["paragraph", "continuation"]})
    assert out["confidences"]["tag"] == 0.56
    assert out["probabilities"]["tag"] == {"paragraph": 0.56, "continuation": 0.44}
