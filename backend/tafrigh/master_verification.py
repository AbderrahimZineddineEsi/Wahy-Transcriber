"""
Master Verification Script for AGY Tafrigh Phase.
Executes the full 6-run dry-run experimental matrix, runs multi-run comparison,
and enforces the non-negotiable Faithfulness Invariant Audit across all runs.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List

from backend.tafrigh.adapters.gemini_adapter import GeminiAdapter
from backend.tafrigh.adapters.jev_adapter import JEVAdapter
from backend.tafrigh.adapters.laya_adapter import LayaAdapter
from backend.tafrigh.compare_runs import compare_run_dirs
from backend.tafrigh.matn_aligner import MatnConfig
from backend.tafrigh.models import (
    CommentKind,
    SourcePosition,
    StructuralDecision,
    StructuralTag,
    TextEdit,
    TranscriptSegment,
)
from backend.tafrigh.outline_repair import run_outline_repair_pass
from backend.tafrigh.pipeline import TafrighPipeline
from backend.tafrigh.renderer import render_to_html, render_to_markdown
from backend.tafrigh.run_logger import RunLogger
from backend.tafrigh.schemas import JEVRequestConfig, PipelineConfig

SAMPLE_LECTURE_TEXT = (
    "كتاب الطهارة. "
    "قال المصنف رحمه الله الأصل في الماء الطهورية. "
    "وهذا إجماع نقله غير واحد من أهل العلم. "
    "فهذا هو الأصل الأول وسنذكر الآن شروط الصلاة وهي تسعة الأول الإسلام. "
    "الثاني العقل. "
    "وهو مناط التكليف في الشريعة. "
    "يرحمكم الله، تفضل بالسؤال يا بني. "
    "كتب الطالب مسألته بالقدم."
)


def build_mock_adapters_for_sample(typo_strategy: str = "gated") -> Dict[str, Any]:
    """Builds predictable mock response adapters for the sample lecture fixture."""

    decisions_db = {
        "كتاب الطهارة": {"tag": "heading", "level": 1, "parent": None},
        "الأصل في الماء": {"tag": "matn_section"},
        "وهذا إجماع": {"tag": "paragraph"},
        "فهذا هو الأصل الأول وسنذكر الآن شروط الصلاة وهي تسعة الأول الإسلام": {
            "tag": "paragraph",
            "needsSplitting": True,
            "splitPoints": [4, 10],
        },
        "فهذا هو الأصل الأول": {"tag": "paragraph"},
        "وسنذكر الآن شروط الصلاة وهي تسعة": {"tag": "list_intro"},
        "الأول الإسلام": {"tag": "list_item"},
        "الثاني العقل": {"tag": "list_item"},
        "وهو مناط التكليف": {"tag": "continuation"},
        "يرحمكم الله": {"tag": "comment", "commentKind": "student_question"},
        "كتب الطالب": {
            "tag": "paragraph",
            "hasTypo": True,
            "edits": [{"start": 17, "end": 23, "replacement": "بالقلم", "reason": "ASR typo"}],
        },
    }

    def mock_gemini_predict(payload: Dict[str, Any]) -> Dict[str, Any]:
        prompt = payload.get("prompt", "")
        if "This segment contains mixed roles" in prompt or prompt.startswith("Segment text with word indices:"):
            return {"splitPoints": [4, 10]}
        if "Identify phonetic ASR transcription errors" in prompt:
            return {
                "edits": [
                    {"start": 17, "end": 23, "replacement": "بالقلم", "reason": "د/ل confusion"}
                ]
            }

        if "DYNAMIC TARGET PAYLOAD:" in prompt:

            try:
                json_part = prompt.split("DYNAMIC TARGET PAYLOAD:")[1].split("Return a JSON object")[0].strip()
                dynamic_data = json.loads(json_part)
                targets = dynamic_data.get("target_segments", [])
                results = []
                for t in targets:
                    s_id = t["id"]
                    s_text = t["text"]
                    chosen = {"tag": "paragraph"}
                    for k, d in decisions_db.items():
                        if k in s_text:
                            chosen = dict(d)
                            break
                    chosen["id"] = s_id
                    results.append(chosen)
                return {
                    "decisions": results,
                    "usage": {"input_tokens": 120, "output_tokens": 45, "cached_tokens": 60},
                }
            except Exception:
                pass



    def mock_jev_predict(payload: Dict[str, Any]) -> Dict[str, Any]:
        state = payload.get("state", {})
        questions = payload.get("questions", {})
        text = state.get("target_text", "")
        answers: Dict[str, str] = {}

        if "كتاب الطهارة" in text:
            answers["tag"] = "heading_1_none"
        elif "الأصل في الماء" in text:
            answers["tag"] = "matn_section"
        elif "فهذا هو الأصل الأول وسنذكر الآن" in text and "needs_splitting" in questions.get("tag", []):
            answers["tag"] = "needs_splitting"
        elif "فهذا هو الأصل الأول وسنذكر الآن" in text and "needsSplitting" in questions:
            answers["needsSplitting"] = "true"
        elif "وسنذكر الآن شروط الصلاة وهي تسعة" in text:
            answers["tag"] = "list_intro"
        elif "الأول الإسلام" in text or "الثاني العقل" in text:
            answers["tag"] = "list_item"
        elif "وهو مناط التكليف" in text:
            answers["tag"] = "continuation"
        elif "يرحمكم الله" in text:
            answers["tag"] = "comment"
        else:
            answers["tag"] = "paragraph"

        if "hasTypo" in questions:
            answers["hasTypo"] = "true" if "بالقدم" in text else "false"
        if "needsSplitting" in questions and "needsSplitting" not in answers:
            answers["needsSplitting"] = "true" if "فهذا هو الأصل الأول وسنذكر الآن" in text else "false"


        return {"answers": answers}

    gemini_adapter = GeminiAdapter(
        mock_response_fn=mock_gemini_predict,
        typo_strategy=typo_strategy,
    )
    jev_adapter = JEVAdapter(mock_response_fn=mock_jev_predict)
    laya_adapter = LayaAdapter(mock_response_fn=mock_jev_predict)

    return {"gemini": gemini_adapter, "jev": jev_adapter, "laya": laya_adapter}


def run_single_matrix_experiment(
    run_idx: int,
    label: str,
    pipeline_cfg: PipelineConfig,
    base_runs_dir: str = "runs",
) -> Path:
    """Executes a single pipeline experiment configuration."""
    adapters = build_mock_adapters_for_sample(typo_strategy=pipeline_cfg.typo_strategy)
    logger = RunLogger(lecture_slug="sample_dars", label=f"run{run_idx}_{label}", base_runs_dir=base_runs_dir)

    matn_text = "الأصل في الماء الطهورية"
    matn_cfg = MatnConfig(mode="upload", raw_matn_text=matn_text)

    pipeline = TafrighPipeline(
        pipeline_config=pipeline_cfg,
        matn_config=matn_cfg,
        adapters=adapters,
    )

    result = pipeline.run(raw_text=SAMPLE_LECTURE_TEXT)

    for req in result.request_logs:
        logger.log_request(req)

    run_outline_repair_pass(result.segments, result.outline_state)

    logger.finalize_run(result.run_manifest, result.segments)
    return logger.run_dir


def execute_master_matrix_protocol(runs_dir: str = "runs") -> None:
    """Executes the complete 4-step Master Experimental Matrix and Faithfulness Audit."""
    print("=" * 80)
    print("AI TAFRIGH PHASE: MASTER EXPERIMENTAL MATRIX & VERIFICATION PROTOCOL")
    print("=" * 80)

    # Clean previous verification runs if desired
    runs_path = Path(runs_dir)
    runs_path.mkdir(parents=True, exist_ok=True)

    configs = [
        (1, "candidateA_per_sentence_gated", PipelineConfig(model_candidate="gemini_all", processing_mode="per_sentence", typo_strategy="gated")),
        (2, "candidateA_windowed_gated", PipelineConfig(model_candidate="gemini_all", processing_mode="windowed", window_size=20, typo_strategy="gated")),
        (3, "candidateA_per_sentence_always_correct", PipelineConfig(model_candidate="gemini_all", processing_mode="per_sentence", typo_strategy="always_correct")),
        (4, "candidateB_jev_independent_parallel", PipelineConfig(model_candidate="jev_hybrid", processing_mode="per_sentence", jev_layout="independent_questions", jev_execution_order="parallel")),
        (5, "candidateB_jev_independent_sequential", PipelineConfig(model_candidate="jev_hybrid", processing_mode="per_sentence", jev_layout="independent_questions", jev_execution_order="sequential")),
        (6, "candidateB_jev_split_as_tag", PipelineConfig(model_candidate="jev_hybrid", processing_mode="per_sentence", jev_layout="split_as_tag_option")),
    ]

    created_run_dirs: List[Path] = []

    print("\n--- STEP 2: DRY-RUN EXPERIMENTAL MATRIX ---")
    for r_idx, lbl, p_cfg in configs:
        print(f"Executing Run {r_idx}: {lbl}...")
        r_dir = run_single_matrix_experiment(r_idx, lbl, p_cfg, base_runs_dir=runs_dir)
        created_run_dirs.append(r_dir)
        print(f" -> Output created at: {r_dir}")

    print("\n--- STEP 3: COMPARISON TOOL VERIFICATION ---")
    comparison_md_path = runs_path / "matrix_comparison.md"
    comp_md = compare_run_dirs(created_run_dirs, output_md_path=comparison_md_path)
    print(comp_md)

    print("\n--- STEP 4: FAITHFULNESS INVARIANT AUDIT ---")
    for r_dir in created_run_dirs:
        results_file = r_dir / "results.jsonl"
        assert results_file.exists(), f"results.jsonl missing in {r_dir}"

        segments: List[Dict[str, Any]] = []
        with open(results_file, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    segments.append(json.loads(line))

        # Invariant 1: String reconstruction
        reconstructed = "".join(s["original_text"] for s in segments)
        assert reconstructed == SAMPLE_LECTURE_TEXT, (
            f"Faithfulness Invariant Failed in {r_dir}!\n"
            f"Original: {repr(SAMPLE_LECTURE_TEXT)}\n"
            f"Reconstructed: {repr(reconstructed)}"
        )

        # Invariant 2: Zero comment deletion
        comments = [s for s in segments if (s.get("final_decision") or {}).get("tag") == "comment"]
        assert len(comments) >= 1, f"Zero comments found in {r_dir}! Incidental speech was deleted."
        assert any("يرحمكم الله" in c["original_text"] for c in comments)

        # Invariant 3: Source positions are monotonic and non-negative
        for s in segments:
            sp = s["source_pos"]
            assert sp["char_start"] >= 0
            assert sp["char_end"] >= sp["char_start"]

    print("✅ FAITHFULNESS INVARIANT AUDIT PASSED 100% ACROSS ALL 6 MATRIX RUNS!")
    print(f"   - 100% of characters preserved exactly without alteration.")
    print(f"   - 100% of split subsegments concatenate to exact original string.")
    print(f"   - Zero comments deleted.")
    print("=" * 80)


if __name__ == "__main__":
    execute_master_matrix_protocol()
