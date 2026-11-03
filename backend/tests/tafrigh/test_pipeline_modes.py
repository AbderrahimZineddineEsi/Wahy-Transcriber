"""
Unit and integration tests for Deliverable 4: Pipeline modes, Unit of Work, and Adapters.
"""

import pytest

from backend.tafrigh.adapters.gemini_adapter import GeminiAdapter
from backend.tafrigh.adapters.jev_adapter import JEVAdapter
from backend.tafrigh.adapters.laya_adapter import LayaAdapter
from backend.tafrigh.models import (
    SourcePosition,
    StructuralDecision,
    StructuralTag,
    TranscriptSegment,
)
from backend.tafrigh.pipeline import TafrighPipeline
from backend.tafrigh.schemas import (
    GeminiWindowItemSchema,
    JEVRequestConfig,
    PipelineConfig,
)
from backend.tafrigh.unit_of_work import build_units_of_work


def create_test_segments(count: int) -> list[TranscriptSegment]:
    segments = []
    for i in range(count):
        seg = TranscriptSegment(
            id=f"seg_{i+1:04d}",
            original_text=f"هذه هي الجملة رقم {i+1} من الدرس.",
            source_pos=SourcePosition(char_start=i * 30, char_end=(i + 1) * 30),
        )
        segments.append(seg)
    return segments


def test_no_segment_receives_two_primary_decisions():
    segments = create_test_segments(25)
    uows = build_units_of_work(segments, mode="windowed", window_size=10)

    # Total targets across all UOWs must equal len(segments) and have no duplicates
    target_ids = []
    for uow in uows:
        for t in uow.target_segments:
            target_ids.append(t.id)

    assert len(target_ids) == 25
    assert len(set(target_ids)) == 25
    assert target_ids == [s.id for s in segments]


def test_windowed_mode_validates_in_window_heading_introductions():
    segments = create_test_segments(6)

    def mock_gemini_decisions(payload):
        # seg_0003 introduces H1 (parent=None)
        # seg_0005 introduces H2 with parent=seg_0003
        decisions = [
            {"id": "seg_0001", "tag": "paragraph", "level": None, "parent": None},
            {"id": "seg_0002", "tag": "paragraph", "level": None, "parent": None},
            {"id": "seg_0003", "tag": "heading", "level": 1, "parent": None},
            {"id": "seg_0004", "tag": "paragraph", "level": None, "parent": None},
            {"id": "seg_0005", "tag": "heading", "level": 2, "parent": "seg_0003"},
            {"id": "seg_0006", "tag": "paragraph", "level": None, "parent": None},
        ]
        return {"decisions": decisions}

    adapter = GeminiAdapter(mock_response_fn=mock_gemini_decisions)
    pipeline = TafrighPipeline(
        pipeline_config=PipelineConfig(processing_mode="windowed", window_size=10, model_candidate="gemini_all"),
        adapters={"gemini": adapter},
    )

    res = pipeline.run(initial_segments=segments)

    assert res.segments[2].final_decision.tag == StructuralTag.HEADING
    assert res.segments[2].final_decision.level == 1
    assert res.segments[4].final_decision.tag == StructuralTag.HEADING
    assert res.segments[4].final_decision.level == 2
    assert res.segments[4].final_decision.parent_id == "seg_0003"


def test_windowed_mode_accepts_answers_in_any_order():
    segments = create_test_segments(3)
    calls = {"count": 0}

    def mock_scrambled(payload):
        calls["count"] += 1
        return {"decisions": [
            {"id": "seg_0002", "tag": "continuation"},
            {"id": "seg_0001", "tag": "paragraph"},
            {"id": "seg_0003", "tag": "comment", "commentKind": "made_up_kind"},
        ]}

    pipeline = TafrighPipeline(
        pipeline_config=PipelineConfig(processing_mode="windowed", window_size=5, model_candidate="gemini_all"),
        adapters={"gemini": GeminiAdapter(mock_response_fn=mock_scrambled)},
    )
    res = pipeline.run(initial_segments=segments)

    assert calls["count"] == 1
    assert [s.final_decision.tag for s in res.segments] == [StructuralTag.PARAGRAPH, StructuralTag.CONTINUATION, StructuralTag.COMMENT]
    assert not any("WINDOW_FALLBACK_USED" in s.review_flags for s in res.segments)


def test_windowed_mode_asks_again_only_for_left_out_sentences():
    segments = create_test_segments(4)
    prompts = []

    def mock_partial(payload):
        prompts.append(payload["prompt"])
        if len(prompts) == 1:   # the window: seg_0003 left out
            return {"decisions": [{"id": f"seg_000{k}", "tag": "paragraph"} for k in (1, 2, 4)]}
        return {"decisions": [{"id": "seg_0003", "tag": "continuation"}]}

    pipeline = TafrighPipeline(
        pipeline_config=PipelineConfig(processing_mode="windowed", window_size=10, model_candidate="gemini_all"),
        adapters={"gemini": GeminiAdapter(mock_response_fn=mock_partial)},
    )
    res = pipeline.run(initial_segments=segments)

    assert len(prompts) == 2
    # the extra request is a normal per-sentence one, with the neighbours as context
    assert "seg_0003" in prompts[1] and "seg_0001" not in prompts[1] and "context_before" in prompts[1]
    assert [s.id for s in res.segments if "WINDOW_FALLBACK_USED" in s.review_flags] == ["seg_0003"]
    assert res.segments[2].final_decision.tag == StructuralTag.CONTINUATION
    assert [log for log in res.request_logs if log.get("fallback_triggered")][0]["missing_ids"] == ["seg_0003"]


def test_window_answers_with_renumbered_ids_are_matched_by_position():
    segments = create_test_segments(2)
    adapter = GeminiAdapter(mock_response_fn=lambda p: {"decisions": [{"id": "1", "tag": "paragraph"}, {"id": "2", "tag": "continuation"}]})
    pipeline = TafrighPipeline(
        pipeline_config=PipelineConfig(processing_mode="windowed", window_size=5, model_candidate="gemini_all"),
        adapters={"gemini": adapter},
    )
    res = pipeline.run(initial_segments=segments)
    assert res.segments[1].final_decision.tag == StructuralTag.CONTINUATION
    assert not any(s.review_flags for s in res.segments)


def test_heading_parent_is_taken_from_the_outline_not_the_model():
    segments = create_test_segments(3)
    adapter = GeminiAdapter(mock_response_fn=lambda p: {"decisions": [
        {"id": "seg_0001", "tag": "heading", "level": 1, "parent": "whatever"},
        {"id": "seg_0002", "tag": "heading", "level": "2", "parent": 7},
        {"id": "seg_0003", "tag": "paragraph", "level": 0, "parent": ""},
    ]})
    pipeline = TafrighPipeline(
        pipeline_config=PipelineConfig(processing_mode="windowed", window_size=5, model_candidate="gemini_all"),
        adapters={"gemini": adapter},
    )
    res = pipeline.run(initial_segments=segments)
    d = [s.final_decision for s in res.segments]
    assert (d[0].tag, d[0].level, d[0].parent_id) == (StructuralTag.HEADING, 1, None)
    assert (d[1].tag, d[1].level, d[1].parent_id) == (StructuralTag.HEADING, 2, "seg_0001")
    assert d[2].tag == StructuralTag.PARAGRAPH
    assert not any("INVALID_TRANSITION_FALLBACK" in s.review_flags for s in res.segments)


def test_windowed_progress_moves_per_sentence_and_shows_the_window_in_flight():
    segments = create_test_segments(6)
    seen = []
    adapter = GeminiAdapter(mock_response_fn=lambda p: {"decisions": [
        {"id": f"seg_{k:04d}", "tag": "paragraph"} for k in range(1, 7) if f"seg_{k:04d}" in p["prompt"]]})
    pipeline = TafrighPipeline(
        pipeline_config=PipelineConfig(processing_mode="windowed", window_size=3, model_candidate="gemini_all"),
        adapters={"gemini": adapter},
    )
    pipeline.on_progress = lambda done, total, msg, info: seen.append((done, info["inflight"], info["requests_planned"]))
    pipeline.run(initial_segments=segments)
    dones = [d for d, _, _ in seen]
    assert dones == sorted(dones) and dones[-1] == 6
    assert (0, {"from": 0, "to": 3}, 2) in seen       # first window on its way, 2 requests expected
    assert {d for d, _, _ in seen} >= {0, 1, 2, 3, 4, 5, 6}


def test_jev_hybrid_parallel_split_discards_tag():
    text = "فهذا هو الأصل الأول وسنذكر الآن شروط الصلاة وهي تسعة الأول الإسلام"
    seg = TranscriptSegment(
        id="seg_0042",
        original_text=text,
        source_pos=SourcePosition(char_start=0, char_end=len(text)),
    )

    def mock_jev(payload):
        questions = payload.get("questions", {})
        answers = {}
        if "tag" in questions:
            answers["tag"] = "paragraph"
        if "hasTypo" in questions:
            answers["hasTypo"] = "false"
        if "needsSplitting" in questions:
            answers["needsSplitting"] = "true"
        return {"answers": answers}

    def mock_gemini(payload):
        prompt = payload.get("prompt", "")
        if "splitPoints" in prompt:
            return {"splitPoints": [4, 10]}
        return {"decisions": [{"id": "dummy", "tag": "paragraph"}]}

    jev_adapter = JEVAdapter(
        config=JEVRequestConfig(execution_order="parallel", jev_layout="independent_questions"),
        mock_response_fn=mock_jev,
    )
    gemini_adapter = GeminiAdapter(mock_response_fn=mock_gemini)

    pipeline = TafrighPipeline(
        pipeline_config=PipelineConfig(
            processing_mode="per_sentence",
            model_candidate="jev_hybrid",
            jev_layout="independent_questions",
            jev_execution_order="parallel",
        ),
        adapters={"jev": jev_adapter, "gemini": gemini_adapter},
    )

    res = pipeline.run(initial_segments=[seg])

    # Seg should be split into 3 subsegments
    assert len(res.segments) == 3
    assert res.segments[0].id == "seg_0042_sub_0"
    assert res.segments[1].id == "seg_0042_sub_1"
    assert res.segments[2].id == "seg_0042_sub_2"


def test_laya_adapter_contract_matches_jev_adapter():
    seg = TranscriptSegment(
        id="seg_test",
        original_text="قال المصنف رحمه الله كتاب الطهارة",
        source_pos=SourcePosition(char_start=0, char_end=33),
    )
    uow = build_units_of_work([seg], mode="per_sentence")[0]

    def mock_predict(payload):
        questions = payload.get("questions", {})
        answers = {}
        for q, opts in questions.items():
            answers[q] = opts[0] if opts else ""
        return {"answers": answers}

    jev = JEVAdapter(mock_response_fn=mock_predict)
    laya = LayaAdapter(mock_response_fn=mock_predict)

    dec_jev = jev.classify_uow(uow)
    dec_laya = laya.classify_uow(uow)

    assert len(dec_jev) == len(dec_laya) == 1
    assert dec_jev[0].tag == dec_laya[0].tag
    assert dec_jev[0].hasTypo == dec_laya[0].hasTypo
    assert dec_jev[0].needsSplitting == dec_laya[0].needsSplitting


def test_cost_is_reported_per_purpose_and_model():
    """A split follow-up made by the helper model shows as its own line, apart from the classifier's."""
    segments = [TranscriptSegment(id="seg_0001", original_text="فهذا هو الأصل الأول وسنذكر الآن شروط الصلاة وهي تسعة",
                                  source_pos=SourcePosition(char_start=0, char_end=51))]

    def mock(payload):
        if "splitPoints" in payload["prompt"] and "decisions" not in payload["prompt"]:
            return {"parsed": {"splitPoints": [4]}, "usage": {"input_tokens": 50, "output_tokens": 5}}
        return {"parsed": {"decisions": [{"id": "seg_0001", "tag": "paragraph", "needsSplitting": True}]},
                "usage": {"input_tokens": 900, "output_tokens": 60}}

    adapter = GeminiAdapter(mock_response_fn=mock)
    pipe = TafrighPipeline(pipeline_config=PipelineConfig(model_candidate="gemini_all"), adapters={"gemini": adapter})
    res = pipe.run(initial_segments=segments)
    rows = {r["purpose"]: r for r in res.run_manifest["cost_breakdown"]}
    assert rows["split"]["input_tokens"] == 50 and rows["classify"]["input_tokens"] >= 900
    assert res.run_manifest["requests_sent"] == sum(r["requests"] for r in res.run_manifest["cost_breakdown"])


def test_helper_requests_do_not_get_the_classifier_prompt_and_survive_its_reply_shape():
    """Regression: with the classifier's system prompt the helper answered {"decisions": [...]} and its fixes were lost."""
    text = "ثم الزكاة همود أحد أركان الإسلام"
    seg = TranscriptSegment(id="s1", original_text=text, source_pos=SourcePosition(char_start=0, char_end=len(text)))
    seen = []
    edit = {"wordStart": 2, "wordEnd": 2, "original": "همود", "replacement": "عمود"}

    def mock(payload):
        seen.append(payload["system"])
        return {"decisions": [{"id": 0, "tag": "paragraph", "edits": [edit], "splitPoints": [3]}]}

    adapter = GeminiAdapter(mock_response_fn=mock)
    assert adapter.get_typo_edits(seg) == [edit]
    assert adapter.get_split_points(seg) == [3]
    assert all('"decisions"' not in s for s in seen)
