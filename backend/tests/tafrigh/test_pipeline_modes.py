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


def test_windowed_mode_fallback_on_omitted_or_scrambled_id():
    segments = create_test_segments(3)

    call_count = {"count": 0}

    def mock_scrambled(payload):
        call_count["count"] += 1
        # Returns scrambled order: seg_0002 before seg_0001
        return {
            "decisions": [
                {"id": "seg_0002", "tag": "paragraph"},
                {"id": "seg_0001", "tag": "paragraph"},
                {"id": "seg_0003", "tag": "paragraph"},
            ]
        }

    adapter = GeminiAdapter(mock_response_fn=mock_scrambled)
    pipeline = TafrighPipeline(
        pipeline_config=PipelineConfig(processing_mode="windowed", window_size=5, model_candidate="gemini_all"),
        adapters={"gemini": adapter},
    )

    res = pipeline.run(initial_segments=segments)

    # Initial attempt + retry attempt = at least 2 calls
    assert call_count["count"] >= 2
    # Segments should be flagged with WINDOW_FALLBACK_USED
    assert all("WINDOW_FALLBACK_USED" in s.review_flags for s in res.segments)
    # Check that a fallback request was logged
    fallback_logs = [log for log in res.request_logs if log.get("fallback_triggered")]
    assert len(fallback_logs) > 0


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
