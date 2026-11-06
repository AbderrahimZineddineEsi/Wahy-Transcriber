"""Verification passes, the user's verdicts and the request log, at the API. Most tests use the fake verifier
and a fake engine (its envelopes come from each finding's own fields, see fakes.fake_envelopes), so what is
checked is the pass's own logic: which findings go out, in what requests, and which verdicts come back. A few
use the real engine worker on the small corpus (envelopes, expand, a restart)."""

from __future__ import annotations

import threading

import pytest
from fakes import FakeEngine
from fastapi.testclient import TestClient
from helpers import wait_for

from wahy.core.ai.fake import FakeVerifier
from wahy.core.ai.laya_local import LayaLocal, LoadedLaya
from wahy.core.ai.log import RequestLog
from wahy.core.ai.models import AiRequest
from wahy.core.gpu import GpuOwner
from wahy.core.settings import REPO_ROOT, Settings
from wahy.features.lectures.parsing import TimedWord
from wahy.features.training.models import Label
from wahy.features.verification import prompts
from wahy.features.verification.models import Verdict
from wahy.features.verification.schemas import PromptConfig
from wahy.main import create_app

SMALL_CORPUS = REPO_ROOT / "engine" / "src" / "fixtures" / "small-corpus.json"
WORDS = [f"w{i}" for i in range(60)]


def finding(i: int, start: int, end: int, **extra) -> dict:
    data = {"id": f"f{i}", "sourceType": "QURAN", "unitId": f"112:{i}", "displayRef": f"الإخلاص: {i}",
            "wordStartIdx": start, "wordEndIdx": end, "segments": [[start, end + 1]], "confidenceBand": "HIGH",
            "totalScore": 20.0, "prefix": "قل", "suffix": "أحد"}
    return data | extra


# five findings: a passage of three verses, then a hadith, then a low-score verse the engine doubts
FINDINGS = [finding(1, 2, 4, passage="p"), finding(2, 5, 7, passage="p"), finding(3, 8, 10, passage="p"),
            finding(4, 20, 25, sourceType="HADITH", unitId="H1", displayRef="البخاري 1"),
            finding(5, 40, 42, totalScore=9.0, confidenceBand="CANDIDATE")]


def run(client, response, timeout: float = 30) -> dict:
    assert response.status_code == 202, response.text
    return client.app.state.jobs.wait(response.json()["job"]["id"], timeout=timeout).model_dump()


def make_lecture(client, findings=FINDINGS, words=WORDS) -> tuple[int, list[dict]]:
    """A lecture with these words and findings (detected by the fake engine). Returns (id, finding rows)."""
    lectures = client.app.state.lectures
    lecture_id = lectures.create_empty(title="درس", source_kind="text")
    lectures.replace_words(lecture_id, [TimedWord(w, i * 0.5, i * 0.5 + 0.4) for i, w in enumerate(words)])
    client.engine.finder = lambda w, o: [dict(f) for f in findings]
    run(client, client.post(f"/api/lectures/{lecture_id}/detect"))
    return lecture_id, client.get(f"/api/lectures/{lecture_id}/findings").json()["findings"]


def use_fake(client, **kw) -> FakeVerifier:
    fake = FakeVerifier(client.app.state.ai.log, **kw)
    client.app.state.ai.fake = fake
    return fake


def verdicts(client, lecture_id: int) -> dict[int, dict]:
    """finding id → its newest verdict, as the web app reads it."""
    return {f["id"]: f["verdict"] for f in client.get(f"/api/lectures/{lecture_id}/findings").json()["findings"]}


def all_verdict_rows(client) -> list[Verdict]:
    with client.app.state.db.session() as s:
        rows = list(s.query(Verdict).order_by(Verdict.id))
        s.expunge_all()
        return rows


FAKE = {"provider": "fake"}


@pytest.fixture
def api(client):
    client.engine = FakeEngine()
    st = client.app.state
    st.detection.engine = st.corpora.engine = st.verification.engine = client.engine
    return client


# ---- choosing the findings and estimating (F-084, F-087) ---------------------------------------------------------


def test_the_default_scope_is_hadiths_and_doubtful_findings_and_all_means_all(api):
    lecture_id, rows = make_lecture(api)
    e = api.post(f"/api/lectures/{lecture_id}/verification/estimate", json={"options": FAKE}).json()
    assert (e["findings"], e["items"], e["requests"]) == (2, 2, 2)            # the hadith and the 9-point verse
    e = api.post(f"/api/lectures/{lecture_id}/verification/estimate",
                 json={"scope": "ALL", "options": FAKE}).json()
    assert (e["findings"], e["items"]) == (5, 3)                               # the passage is one item
    e = api.post(f"/api/lectures/{lecture_id}/verification/estimate",
                 json={"scope": "HADITH_ONLY", "options": FAKE}).json()
    assert e["findings"] == 1


def test_three_findings_picked_by_hand_are_exactly_the_ones_sent(api):
    lecture_id, rows = make_lecture(api)
    fake = use_fake(api)
    picked = [rows[0]["id"], rows[3]["id"], rows[4]["id"]]
    no_passages = {**FAKE, "prompt": {"rules": {"passages": False}}}
    job = run(api, api.post(f"/api/lectures/{lecture_id}/verification",
                            json={"finding_ids": picked, "options": no_passages}))
    assert job["status"] == "done", job["error"]
    assert [ids[0] for ids in fake.calls] == [str(i) for i in picked]
    got = verdicts(api, lecture_id)
    assert [fid for fid, v in got.items() if v] == picked
    assert api.post(f"/api/lectures/{lecture_id}/verification", json={"finding_ids": [999]}).status_code == 404


def test_the_estimate_halves_with_half_the_findings_and_follows_the_options(api):
    words = [f"w{i}" for i in range(400)]
    many = [finding(i, i * 10, i * 10 + 3, sourceType="HADITH", unitId=f"H{i}") for i in range(20)]
    lecture_id, rows = make_lecture(api, many, words)
    ids = [r["id"] for r in rows]

    def estimate(picked, **options):
        return api.post(f"/api/lectures/{lecture_id}/verification/estimate",
                        json={"finding_ids": picked, "options": {"provider": "gemini", **options}}).json()

    full, half = estimate(ids), estimate(ids[:10])
    assert (full["findings"], half["findings"]) == (20, 10)
    assert (full["requests"], half["requests"]) == (4, 2)                      # 5 findings per Gemini request
    assert half["approx_input_tokens"] == pytest.approx(full["approx_input_tokens"] / 2, rel=0.05)
    assert full["est_cost_usd"] == 0 and full["est_seconds"] == 60              # free tier: 4 requests in a minute
    paid = estimate(ids, gemini_free_tier=False)
    assert paid["est_cost_usd"] > 0 and paid["est_seconds"] == 10
    assert estimate(ids, gemini_batch_size=10)["requests"] == 2
    jev = estimate(ids, provider="jev")
    assert jev["requests"] == 20 and jev["est_cost_usd"] == pytest.approx(jev["approx_input_tokens"] / 1e6 * 0.042,
                                                                          abs=1e-6)


# ---- a pass (F-088, F-089, F-095) --------------------------------------------------------------------------------


def test_a_pass_saves_one_verdict_per_finding_each_linked_to_its_request(api):
    lecture_id, rows = make_lecture(api)
    use_fake(api, cost_usd=0.002)
    job = run(api, api.post(f"/api/lectures/{lecture_id}/verification", json={"scope": "ALL", "options": FAKE}))
    assert job["status"] == "done", job["error"]
    assert job["progress"]["findings_done"] == job["progress"]["findings_total"] == 5
    assert (job["progress"]["requests_done"], job["progress"]["requests_total"]) == (3, 3)

    got = verdicts(api, lecture_id)
    assert all(v and v["verdict"] == "CORRECT" and v["verifier"] == "fake" for v in got.values())
    saved = all_verdict_rows(api)
    assert len(saved) == 5 and all(v.ai_request_id and v.job_id == job["id"] for v in saved)
    assert saved[0].details["probabilities"]["CORRECT"] == 0.9 and saved[0].confidence == 0.9
    assert saved[0].details["passage"]["verses"] == 3                          # judged as one passage

    m = api.get(f"/api/verification/passes/{job['id']}").json()
    log = api.get("/api/telemetry/requests", params={"job_id": job["id"]}).json()
    assert m["requests"] == log["total"] == 3
    assert m["cost_usd"] == pytest.approx(sum(r["cost_usd"] for r in log["items"])) == pytest.approx(0.006)
    assert m["verdict_counts"] == {"CORRECT": 5, "FALSE": 0, "NOT_SURE": 0}
    assert (m["findings_total"], m["findings_verified"], m["findings_failed"]) == (5, 5, 0)
    assert job["result"]["cost_usd"] == m["cost_usd"]
    # F-095: one row per request, with the findings it judged and their verdicts
    passage = log["items"][-1]
    assert [f["finding_id"] for f in passage["findings"]] == [r["id"] for r in rows[:3]]
    assert passage["findings"][0]["verdict"] == "CORRECT" and passage["findings"][0]["probabilities"]["CORRECT"] == 0.9


def test_pause_then_resume_gives_every_finding_exactly_one_verdict(api):
    lecture_id, rows = make_lecture(api)
    gate = threading.Event()

    def slow(item):
        gate.wait(5)
        return {"verdict": "FALSE", "confidence": 0.8}

    use_fake(api, answer=slow)
    started = api.post(f"/api/lectures/{lecture_id}/verification", json={"scope": "ALL", "options": FAKE}).json()
    job_id = started["job"]["id"]
    jobs = api.app.state.jobs
    api.post(f"/api/jobs/{job_id}/pause")
    gate.set()
    wait_for(lambda: jobs.get(job_id).status == "paused", what="paused")
    done_while_paused = len(all_verdict_rows(api))
    assert done_while_paused < 5
    api.post(f"/api/jobs/{job_id}/resume")
    assert jobs.wait(job_id, timeout=10).status == "done"
    saved = all_verdict_rows(api)
    assert sorted(v.finding_id for v in saved) == sorted(r["id"] for r in rows)   # exactly one each
    assert {v.verdict for v in saved} == {"FALSE"}


def test_cancel_stops_the_pass_and_keeps_the_verdicts_already_given(api):
    lecture_id, rows = make_lecture(api)
    gate = threading.Event()
    use_fake(api, answer=lambda item: (gate.wait(5), {"verdict": "CORRECT"})[1])
    job_id = api.post(f"/api/lectures/{lecture_id}/verification",
                      json={"scope": "ALL", "options": FAKE}).json()["job"]["id"]
    api.post(f"/api/jobs/{job_id}/cancel")
    gate.set()
    assert api.app.state.jobs.wait(job_id, timeout=10).status == "cancelled"
    assert len(all_verdict_rows(api)) < 5


def test_a_failed_request_marks_its_findings_and_a_fatal_one_stops_the_pass(api):
    lecture_id, rows = make_lecture(api)
    ids = [r["id"] for r in rows]
    no_passages = {**FAKE, "prompt": {"rules": {"passages": False}}}
    use_fake(api, fail={str(ids[1])})
    job = run(api, api.post(f"/api/lectures/{lecture_id}/verification", json={"scope": "ALL", "options": no_passages}))
    assert job["status"] == "done"
    assert job["result"]["failed"] == [{"finding_id": ids[1], "error": f"fake failure for {ids[1]}"}]
    assert verdicts(api, lecture_id)[ids[1]] is None and len(all_verdict_rows(api)) == 4
    failed = api.get("/api/telemetry/requests", params={"ok": False}).json()["items"]
    assert [f["finding_id"] for f in failed[0]["findings"]] == [ids[1]]   # the log names a failed request's finding

    use_fake(api, fatal_fail={str(ids[2])})
    job = run(api, api.post(f"/api/lectures/{lecture_id}/verification", json={"scope": "ALL", "options": no_passages}))
    assert job["status"] == "failed" and "fake failure" in job["error"]
    assert len(all_verdict_rows(api)) == 4 + 2                               # the two before it were saved


def test_a_second_pass_on_the_same_lecture_waits_for_the_first(api):
    lecture_id, _ = make_lecture(api)
    gate = threading.Event()
    use_fake(api, answer=lambda item: (gate.wait(5), {"verdict": "CORRECT"})[1])
    first = api.post(f"/api/lectures/{lecture_id}/verification", json={"options": FAKE})
    assert api.post(f"/api/lectures/{lecture_id}/verification", json={"options": FAKE}).status_code == 409
    gate.set()
    run(api, first)
    assert api.post(f"/api/lectures/{lecture_id}/verification", json={"options": FAKE}).status_code == 202


# ---- boundaries -------------------------------------------------------------------------------------------------


def test_a_passage_boundary_goes_to_its_first_and_last_verse(api):
    lecture_id, rows = make_lecture(api)
    use_fake(api, answer=lambda item: {"verdict": "CORRECT", "confidence": 0.9, "boundary_status": "MISSING_BOTH",
                                       "boundary_confidence": 0.8})
    run(api, api.post(f"/api/lectures/{lecture_id}/verification", json={"scope": "ALL", "options": FAKE}))
    got = verdicts(api, lecture_id)
    first, inner, last = (got[r["id"]]["boundary"] for r in rows[:3])
    assert (first, inner, last) == ("MISSING_START", "COMPLETE", "MISSING_END")
    assert got[rows[3]["id"]]["boundary"] == "MISSING_BOTH"                   # not in a passage: as answered
    rows_saved = {v.finding_id: v for v in all_verdict_rows(api)}
    d = rows_saved[rows[0]["id"]].details
    assert (d["start_missing_p"], d["end_missing_p"], d["passage"]["position"]) == (0.8, 0.0, "first")


def test_a_boundary_the_corpus_cannot_have_is_dropped(api):
    """normalizeBoundaryVerdict: no corpus words before the match → the start cannot be missing."""
    lecture_id, rows = make_lecture(api, [finding(1, 2, 4, prefix="", suffix="أحد")])
    use_fake(api, answer=lambda item: {"verdict": "CORRECT", "boundary_status": "MISSING_BOTH"})
    run(api, api.post(f"/api/lectures/{lecture_id}/verification", json={"scope": "ALL", "options": FAKE}))
    assert verdicts(api, lecture_id)[rows[0]["id"]]["boundary"] == "MISSING_END"


# ---- Laya (F-093) -----------------------------------------------------------------------------------------------


class FakeAgent:
    def __init__(self, answers):
        self.answers, self.seen = answers, []

    def predict(self, state, questions, max_len):
        self.seen.append((state, questions))
        return {"answers": self.answers}


def use_laya(client, config: dict, answers: dict) -> FakeAgent:
    agent = FakeAgent(answers)
    gpu = GpuOwner(free_memory=lambda: None, poll_s=0.01)
    client.app.state.ai.laya = LayaLocal(
        RequestLog(client.app.state.db), gpu, loader=lambda c, d: LoadedLaya(agent, c, "cpu", dict(config)),
        read_config=lambda c: dict(config), installed=lambda: True, vram=lambda: {})
    return agent


def test_laya_reads_its_checkpoints_envelope_and_only_its_questions(api):
    lecture_id, rows = make_lecture(api, FINDINGS[:3])
    agent = use_laya(api, {"wahy_envelope": 3, "wahy_envelope_options": {"passages": True},
                           "wahy_questions": ["verdict", "start_missing", "end_missing"]},
                     {"verdict": {"choice": "CORRECT", "confidence": 0.95},
                      "start_missing": {"noul": 0.9}, "end_missing": {"noul": 0.1}})
    job = run(api, api.post(f"/api/lectures/{lecture_id}/verification",
                            json={"scope": "ALL", "options": {"provider": "laya", "laya_checkpoint": "ckpt/v3"}}))
    assert job["status"] == "done", job["error"]
    assert api.engine.envelope_calls[-1][0] == 3 and api.engine.envelope_calls[-1][1]["passages"] is True
    (state, questions), = agent.seen                                           # one passage, one request
    assert "engine_score" not in state and set(questions) == {"verdict", "start_missing", "end_missing"}
    got = verdicts(api, lecture_id)
    assert [got[r["id"]]["boundary"] for r in rows] == ["MISSING_START", "COMPLETE", "COMPLETE"]
    assert got[rows[0]["id"]]["model"] == "ckpt/v3"


def test_a_verdict_only_checkpoint_gets_its_boundary_from_the_word_overlap_rule(api):
    data = [finding(1, 2, 4, heard_start="1 of 2", heard_end="")]
    lecture_id, rows = make_lecture(api, data)
    agent = use_laya(api, {"wahy_envelope": 2, "wahy_envelope_options": {"passages": False, "neighbours": True},
                           "wahy_questions": ["verdict"]}, {"verdict": {"choice": "CORRECT", "confidence": 0.9}})
    run(api, api.post(f"/api/lectures/{lecture_id}/verification",
                      json={"scope": "ALL", "options": {"provider": "laya"}}))
    version, options = api.engine.envelope_calls[-1]
    assert (version, options["passages"], options["neighbours"]) == (2, False, True)
    assert set(agent.seen[0][1]) == {"verdict"} and len(api.engine.rule_calls) == 1
    v = all_verdict_rows(api)[0]
    assert (v.boundary, v.details["boundary_source"]) == ("MISSING_START", "rule")


def test_a_v1_checkpoint_reads_envelope_v1(api):
    lecture_id, _ = make_lecture(api, FINDINGS[:3])
    agent = use_laya(api, {}, {"verdict": {"choice": "FALSE"}, "boundary_status": {"choice": "COMPLETE_SPAN"}})
    run(api, api.post(f"/api/lectures/{lecture_id}/verification",
                      json={"scope": "ALL", "options": {"provider": "laya", "context_words": 30}}))
    version, options = api.engine.envelope_calls[-1]
    assert (version, options["passages"], options["contextWords"]) == (1, False, 30)
    assert len(agent.seen) == 3 and "boundary_status" in agent.seen[0][1]


# ---- prompts and preview (F-085, F-086, F-092, N-020) ------------------------------------------------------------


def test_the_preview_shows_the_exact_request_with_the_preset_and_rules(api):
    merge = {"neighborIds": {"previous": "f1", "next": None},
             "neighbors": {"previous": {"candidate_reference": "الإخلاص: 1"}, "next": None},
             "questions": {"merge_suggestion": {"type": "choice", "criteria": {"NO_MERGE": "-"}}}}
    lecture_id, rows = make_lecture(api, [finding(1, 2, 4), finding(2, 6, 8, merge=merge)])
    body = {"finding_id": rows[1]["id"], "options": {"provider": "gemini", "prompt": {
        "preset": "strict", "rules": {"cue_before_garbled": True}, "reason_lang": "en"}}}
    p = api.post(f"/api/lectures/{lecture_id}/verification/preview", json=body).json()
    instructions = p["questions"]["verdict"]["instructions"]
    assert prompts.PRESETS["strict"]["verdict_addendum"] in instructions
    assert prompts.RULES["cue_before_garbled"]["text"] in instructions
    assert prompts.RULES["narrator_names"]["text"] not in instructions        # off by default
    assert p["questions"]["verdict"]["criteria"]["CORRECT"] == prompts.PRESETS["strict"]["criteria"]["CORRECT"]
    assert p["system_prompt"].endswith("Write the `reason` field in English, one short sentence.")
    # F-092: the neighbour and the merge question go out with it
    assert p["state"]["neighbor_findings"]["previous"]["candidate_reference"] == "الإخلاص: 1"
    assert "merge_suggestion" in p["questions"]
    # the body is what Gemini would get: the system prompt, and the item with its finding id
    assert p["body"]["systemInstruction"]["parts"][0]["text"] == p["system_prompt"]
    assert f'"finding_id": "{rows[1]["id"]}"' in p["body"]["contents"][0]["parts"][0]["text"]
    assert p["endpoint"].endswith("gemini-3.5-flash-lite:generateContent") and p["approx_tokens"] > 100

    laya = api.post(f"/api/lectures/{lecture_id}/verification/preview",
                    json={"finding_id": rows[1]["id"], "options": {"provider": "jev"}}).json()
    assert laya["system_prompt"] == "" and laya["body"]["state"] == laya["state"]


def test_the_merge_suggestion_is_saved_with_the_neighbours_own_finding_id(api):
    merge = {"neighborIds": {"previous": "f1", "next": None}, "neighbors": {"previous": {}, "next": None},
             "questions": {"merge_suggestion": {"type": "choice", "criteria": {}}}}
    lecture_id, rows = make_lecture(api, [finding(1, 2, 4), finding(2, 6, 8, merge=merge)])
    use_fake(api, answer=lambda item: {"verdict": "CORRECT", "merge_suggestion": "MERGE_WITH_PREVIOUS",
                                       "merge_gap_type": "COMMENTARY"})
    run(api, api.post(f"/api/lectures/{lecture_id}/verification",
                      json={"finding_ids": [rows[1]["id"]], "options": FAKE}))
    m = all_verdict_rows(api)[0].details["merge"]
    assert (m["previous"], m["previous_id"], m["gap_type"]) == (True, rows[0]["id"], "COMMENTARY")


def test_the_two_review_note_rules_are_optional_prompt_rules():
    questions = {"verdict": {"instructions": "base", "criteria": {}}}
    off = prompts.compose_questions(questions, PromptConfig())
    on = prompts.compose_questions(questions, PromptConfig.model_validate(
        {"rules": {"cue_before_garbled": True, "explaining_with_text": True}}))
    assert "garbled" not in off["verdict"]["instructions"]
    assert prompts.RULES["cue_before_garbled"]["text"] in on["verdict"]["instructions"]
    assert prompts.RULES["explaining_with_text"]["text"] in on["verdict"]["instructions"]
    assert questions["verdict"]["instructions"] == "base"                    # the envelope is never changed


def test_the_verifier_settings_are_saved_and_the_prompt_texts_are_served(api):
    assert api.get("/api/verification/settings").json()["provider"] == "gemini"
    r = api.patch("/api/verification/settings", json={"provider": "laya", "gemini_batch_size": 8})
    assert (r.json()["provider"], r.json()["gemini_batch_size"]) == ("laya", 8)
    assert api.get("/api/verification/settings").json()["provider"] == "laya"
    assert api.patch("/api/verification/settings", json={"gemini_batch_size": 50}).status_code == 422
    catalog = api.get("/api/verification/prompts").json()
    assert set(catalog["presets"]) == {"balanced", "strict", "lenient", "boundaries"}
    assert {"cue_before_garbled", "explaining_with_text"} <= set(catalog["rules"])
    assert catalog["default_system_prompt"].startswith("You verify quotations")


# ---- the user's verdicts (F-065, F-091) --------------------------------------------------------------------------


def labels(client) -> list[Label]:
    with client.app.state.db.session() as s:
        rows = list(s.query(Label).order_by(Label.id))
        s.expunge_all()
        return rows


def test_the_users_verdict_is_the_newest_and_a_gold_label(api):
    lecture_id, rows = make_lecture(api)
    use_fake(api)
    run(api, api.post(f"/api/lectures/{lecture_id}/verification", json={"scope": "ALL", "options": FAKE}))
    fid = rows[3]["id"]
    r = api.put(f"/api/findings/{fid}/verdict", json={"verdict": "FALSE"})
    assert r.status_code == 200 and r.json()["boundary"] == "COMPLETE"        # the pass's boundary stays
    v = verdicts(api, lecture_id)[fid]
    assert (v["verdict"], v["verifier"]) == ("FALSE", "human")
    (label,) = labels(api)
    assert (label.source, label.verdict, label.finding_id) == ("user", "FALSE", fid)
    assert label.card["envelope"]["version"] == 1 and label.card["envelope"]["state"]["source_type"] == "HADITH"
    assert label.card["verdict"]["ai"]["verifier"] == "fake"                   # what it corrected
    assert label.card["finding"]["unitId"] == "H1"

    api.put(f"/api/findings/{fid}/verdict", json={"verdict": "CORRECT", "boundary": "EXTRA_END"})
    (label,) = labels(api)                                                     # still one label, updated
    assert (label.verdict, label.boundary) == ("CORRECT", "EXTRA_END")
    assert api.put("/api/findings/9999/verdict", json={"verdict": "FALSE"}).status_code == 404
    assert api.put(f"/api/findings/{fid}/verdict", json={"verdict": "MAYBE"}).status_code == 422


def test_approve_all_makes_every_ai_verdict_a_gold_label_once(api):
    lecture_id, rows = make_lecture(api)
    use_fake(api, answer=lambda item: {"verdict": "NOT_SURE"})
    run(api, api.post(f"/api/lectures/{lecture_id}/verification", json={"options": FAKE}))   # 2 in the scope
    api.put(f"/api/findings/{rows[3]['id']}/verdict", json={"verdict": "CORRECT"})          # already the user's
    r = api.post(f"/api/lectures/{lecture_id}/verification/approve").json()
    assert r == {"approved": 1, "labels": 1}
    assert {lb.finding_id: lb.verdict for lb in labels(api)} == {rows[3]["id"]: "CORRECT", rows[4]["id"]: "NOT_SURE"}
    assert verdicts(api, lecture_id)[rows[4]["id"]]["verifier"] == "human"
    assert api.post(f"/api/lectures/{lecture_id}/verification/approve").json() == {"approved": 0, "labels": 0}


# ---- the request log (F-095, F-096) ------------------------------------------------------------------------------


def test_the_request_inspector_shows_the_exact_payload_and_the_log_can_be_cleared(api):
    lecture_id, rows = make_lecture(api)
    use_fake(api)
    run(api, api.post(f"/api/lectures/{lecture_id}/verification", json={"finding_ids": [rows[3]["id"]],
                                                                          "options": FAKE}))
    (row,) = api.get("/api/telemetry/requests", params={"lecture_id": lecture_id}).json()["items"]
    detail = api.get(f"/api/telemetry/requests/{row['id']}").json()
    with api.app.state.db.session() as s:
        assert detail["request"] == s.get(AiRequest, row["id"]).request          # exactly what was sent
    assert detail["request"]["finding_id"] == str(rows[3]["id"]) and detail["response"]["verdict"] == "CORRECT"
    assert row["context_chars"] > 50 and row["findings"][0]["display_ref"] == "البخاري 1"

    api.put(f"/api/findings/{rows[3]['id']}/verdict", json={"verdict": "FALSE"})
    row = api.get("/api/telemetry/requests").json()["items"][0]
    assert row["findings"][0]["human"] == {"verdict": "FALSE", "boundary": "COMPLETE"}  # the manual correction

    assert api.delete("/api/telemetry/requests", params={"lecture_id": lecture_id}).json() == {"deleted": 1}
    assert api.get("/api/telemetry/requests").json()["total"] == 0
    assert api.get(f"/api/telemetry/requests/{row['id']}").status_code == 404
    assert all_verdict_rows(api)[0].ai_request_id is None                     # the verdict stays, unlinked


# ---- the real engine, small corpus -------------------------------------------------------------------------------

LESSON = ("قال الله تعالى قل هو الله أحد الله الصمد لم يلد ولم يولد ولم يكن له كفوا أحد ثم قال النبي صلى الله "
          "عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى وهذا كلام عادي في الدرس")


def real_settings(data_dir) -> Settings:
    return Settings(data_dir=data_dir, corpus_path=SMALL_CORPUS, engine_max_heap_mb=1024, engine_timeout_s=120,
                    _env_file=None)


@pytest.fixture
def real(tmp_path):
    with TestClient(create_app(real_settings(tmp_path / "data"))) as c:
        c.patch("/api/detection/settings", json={"engine": "v3"})
        yield c


def real_lecture(client, text: str = LESSON) -> tuple[int, list[dict]]:
    lectures = client.app.state.lectures
    lecture_id = lectures.create_empty(title="درس", source_kind="text")
    lectures.replace_words(lecture_id, [TimedWord(w, i * 0.5, i * 0.5 + 0.4) for i, w in enumerate(text.split())])
    run(client, client.post(f"/api/lectures/{lecture_id}/detect"), timeout=120)
    return lecture_id, client.get(f"/api/lectures/{lecture_id}/findings").json()["findings"]


def test_a_pass_with_the_real_engine_sends_its_envelopes(real):
    lecture_id, rows = real_lecture(real)
    assert [r["display_ref"] for r in rows][:4] == ["الإخلاص: 1", "الإخلاص: 2", "الإخلاص: 3", "الإخلاص: 4"]
    fake = use_fake(real)
    job = run(real, real.post(f"/api/lectures/{lecture_id}/verification", json={"scope": "ALL", "options": FAKE}))
    assert job["status"] == "done", job["error"]
    assert len(fake.calls) == len(rows) - 3                                   # the four verses are one passage
    assert job["result"]["findings_verified"] == len(rows)
    p = real.post(f"/api/lectures/{lecture_id}/verification/preview",
                  json={"finding_id": rows[1]["id"], "options": {"provider": "openrouter"}}).json()
    assert p["finding_ids"] == [r["id"] for r in rows[:4]] and p["state"]["candidate_reference"] == "الإخلاص: 1-4"
    assert p["body"]["messages"][0]["role"] == "system"


def test_expand_grows_a_finding_over_its_missing_start(real):
    lecture_id, rows = real_lecture(real)
    hadith = next(r for r in rows if r["source_type"] == "HADITH")
    start, end = hadith["word_start"], hadith["word_end"]
    # what an engine that missed the first two words would have saved
    from wahy.features.detection.models import Finding
    with real.app.state.db.session() as s:
        row = s.get(Finding, hadith["id"])
        d = dict(row.data)
        d["wordStartIdx"] = start + 2
        d["segments"] = [[start + 2, end + 1]]
        d["qSegments"] = [[d["qSegments"][0][0] + 2, d["qSegments"][-1][1]]]
        row.data, row.word_start = d, start + 2
    real.put(f"/api/findings/{hadith['id']}/verdict", json={"verdict": "CORRECT", "boundary": "MISSING_START"})
    r = real.post(f"/api/findings/{hadith['id']}/expand").json()
    assert (r["changed"], r["added"], r["word_start"], r["word_end"]) == (True, {"start": 2, "end": 0}, start, end)
    f = next(x for x in real.get(f"/api/lectures/{lecture_id}/findings").json()["findings"] if x["id"] == hadith["id"])
    assert (f["word_start"], f["data"]["wordStartIdx"]) == (start, start)
    assert (f["verdict"]["verdict"], f["verdict"]["boundary"]) == ("CORRECT", "COMPLETE")
    again = real.post(f"/api/findings/{hadith['id']}/expand", json={"boundary": "MISSING_START"}).json()
    assert (again["changed"], again["reason"]) == (False, "no_match")


def test_a_pass_interrupted_by_a_restart_resumes_where_it_stopped(tmp_path):
    data_dir = tmp_path / "data"
    no_passages = {**FAKE, "prompt": {"rules": {"passages": False}}}
    gate = threading.Event()
    with TestClient(create_app(real_settings(data_dir))) as c:
        c.patch("/api/detection/settings", json={"engine": "v3"})
        lecture_id, rows = real_lecture(c)
        sent: list[str] = []

        def second_blocks(item):
            sent.append(item.id)
            if len(sent) == 2:
                gate.wait(3)                                                   # the server stops meanwhile
            return {"verdict": "CORRECT"}

        use_fake(c, answer=second_blocks)
        job_id = c.post(f"/api/lectures/{lecture_id}/verification",
                        json={"scope": "ALL", "options": no_passages}).json()["job"]["id"]
        wait_for(lambda: len(sent) == 2, what="the second request")
    gate.set()
    with TestClient(create_app(real_settings(data_dir))) as c:
        jobs = c.app.state.jobs
        assert jobs.get(job_id).status == "interrupted"
        fake = use_fake(c)
        assert c.post(f"/api/jobs/{job_id}/resume").status_code == 200
        assert jobs.wait(job_id, timeout=60).status == "done"
        # the request running at the stop was finished first, so the two made before are not sent again
        assert [ids[0] for ids in fake.calls] == [str(r["id"]) for r in rows[2:]]
        assert sorted(v.finding_id for v in all_verdict_rows(c)) == sorted(r["id"] for r in rows)
