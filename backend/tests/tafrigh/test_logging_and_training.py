"""
Unit tests for Deliverables 6 & 7: Run Logging, Comparison, Canonical Store, and Exporters.
"""

import json
from pathlib import Path
import pytest

from backend.tafrigh.compare_runs import compare_run_dirs
from backend.tafrigh.exporters import export_for_jev_or_laya, export_for_llm_chat_jsonl
from backend.tafrigh.models import SourcePosition, StructuralDecision, StructuralTag, TranscriptSegment
from backend.tafrigh.run_logger import RunLogger
from backend.tafrigh.training_store import (
    CanonicalTrainingRecord,
    TrainingStore,
    anonymize_personal_details,
)


def test_run_logger_artifacts_generation(tmp_path: Path):
    logger = RunLogger(lecture_slug="test_dars", label="exp1", base_runs_dir=str(tmp_path))

    # Log two mock requests
    logger.log_request({
        "request_id": "req_001",
        "purpose": "classify",
        "latency_ms": 120.0,
        "input_tokens": 150,
        "output_tokens": 40,
        "cached_tokens": 50,
        "cost_estimate_usd": 0.0001,
        "fallback_triggered": False,
    })
    logger.log_request({
        "request_id": "req_002",
        "purpose": "split",
        "latency_ms": 80.0,
        "input_tokens": 100,
        "output_tokens": 20,
        "cached_tokens": 0,
        "cost_estimate_usd": 0.00005,
        "fallback_triggered": False,
    })

    seg = TranscriptSegment(
        id="seg_001",
        original_text="نص تجريبي للتقرير",
        source_pos=SourcePosition(char_start=0, char_end=17),
        final_decision=StructuralDecision(tag=StructuralTag.PARAGRAPH),
    )

    manifest = {
        "run_id": "run_test_001",
        "model_candidate": "gemini_all",
        "processing_mode": "per_sentence",
        "num_segments": 1,
        "wall_clock_seconds": 0.35,
    }

    report = logger.finalize_run(manifest, [seg])

    # Check files exist
    assert logger.manifest_file.exists()
    assert logger.requests_log_file.exists()
    assert logger.results_log_file.exists()
    assert logger.report_json_file.exists()
    assert logger.report_md_file.exists()

    assert report["total_requests"] == 2
    assert report["total_input_tokens"] == 250
    assert "classify" in report["latency_by_purpose_ms"]


def test_compare_runs_markdown_and_diff(tmp_path: Path):
    # Setup Run A
    logger_a = RunLogger(lecture_slug="dars", label="run_a", base_runs_dir=str(tmp_path))
    seg_a = TranscriptSegment(
        id="s1",
        original_text="الجملة الأولى",
        source_pos=SourcePosition(char_start=0, char_end=12),
        final_decision=StructuralDecision(tag=StructuralTag.PARAGRAPH),
    )
    logger_a.finalize_run(
        {"run_id": "run_a", "model_candidate": "gemini_all", "processing_mode": "per_sentence", "wall_clock_seconds": 1.0},
        [seg_a],
    )

    # Setup Run B (different tag for s1)
    logger_b = RunLogger(lecture_slug="dars", label="run_b", base_runs_dir=str(tmp_path))
    seg_b = TranscriptSegment(
        id="s1",
        original_text="الجملة الأولى",
        source_pos=SourcePosition(char_start=0, char_end=12),
        final_decision=StructuralDecision(tag=StructuralTag.HEADING, level=1),
    )
    logger_b.finalize_run(
        {"run_id": "run_b", "model_candidate": "jev_hybrid", "processing_mode": "per_sentence", "wall_clock_seconds": 2.0},
        [seg_b],
    )

    out_file = tmp_path / "comparison.md"
    md_content = compare_run_dirs([logger_a.run_dir, logger_b.run_dir], out_file)

    assert out_file.exists()
    assert "gemini_all" in md_content
    assert "jev_hybrid" in md_content
    assert "Per-Segment Disagreements" in md_content
    assert "s1" in md_content


def test_canonical_training_store_and_exporters(tmp_path: Path):
    store_file = tmp_path / "canonical.jsonl"
    store = TrainingStore(str(store_file))

    # Record 1: Unreviewed (model_proposed)
    r1 = CanonicalTrainingRecord(
        record_id="r1",
        segment_id="s1",
        original_text="شرح الفقه",
        source_pos={"char_start": 0, "char_end": 9},
        context_shown={"context_before": [], "context_after": []},
        dynamic_choice_list=[{"tag": "paragraph"}],
        validation_result={"is_valid": True},
        final_accepted_decision={"tag": "paragraph"},
        review_status={"provenance": "model_proposed", "review_action": "unreviewed"},
    )
    store.append_record(r1)

    # Record 2: Verified (human_confirmed)
    r2 = CanonicalTrainingRecord(
        record_id="r2",
        segment_id="s2",
        original_text="شروط الصلاة تسعة",
        source_pos={"char_start": 10, "char_end": 26},
        context_shown={"context_before": [], "context_after": []},
        dynamic_choice_list=[{"tag": "list_intro"}, {"tag": "paragraph"}],
        validation_result={"is_valid": True},
        final_accepted_decision={"tag": "list_intro"},
        review_status={"provenance": "human_confirmed", "review_action": "confirmed"},
    )
    store.append_record(r2)

    all_recs = store.load_all_records()
    assert len(all_recs) == 2

    # Test exporter strict filtering (only r2 should be exported)
    laya_out = tmp_path / "laya_export.jsonl"
    count_laya = export_for_jev_or_laya(str(store_file), str(laya_out), include_unreviewed=False)
    assert count_laya == 1

    chat_out = tmp_path / "chat_export.jsonl"
    count_chat = export_for_llm_chat_jsonl(str(store_file), str(chat_out), include_unreviewed=False)
    assert count_chat == 1


def test_anonymize_personal_details():
    # Text with student name and phone number
    text = "سأل الطالب محمد زيدان رقم هاتفه 0501234567 عن مسألة في الصلاة"
    clean = anonymize_personal_details(text)

    # Student name and phone number should be masked
    assert "0501234567" not in clean
    assert "[بيانات شخصية]" in clean
    assert "[اسم طالب]" in clean

    # Classical scholar name must NOT be masked
    scholarly_text = "قال الإمام مالك رحمه الله في الموطأ"
    scholarly_clean = anonymize_personal_details(scholarly_text)
    assert "مالك" in scholarly_clean
    assert "[اسم طالب]" not in scholarly_clean
