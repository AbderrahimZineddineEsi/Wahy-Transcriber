"""
Pipeline Orchestrator for Wahy-Transcriber AI Tafrigh Phase.
Executes Stages 1 through 7 in both per_sentence and windowed processing modes.
Ensures zero text mutation, full provenance tracking, and graceful fallback handling.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

from .adapters.base import BaseAdapter
from .adapters.gemini_adapter import GeminiAdapter
from .adapters.jev_adapter import JEVAdapter
from .adapters.laya_adapter import LayaAdapter
from .matn_aligner import MatnConfig, SequentialMatnAligner
from .models import (
    HeadingEntry,
    LectureSpan,
    OutlineState,
    StructuralDecision,
    StructuralTag,
    TranscriptSegment,
)
from .schemas import (
    GeminiSingleOutputSchema,
    GeminiWindowItemSchema,
    JEVRequestConfig,
    PipelineConfig,
)
from .segmenter import segment_transcript
from .unit_of_work import UnitOfWork, build_units_of_work
from .validators import (
    validate_and_apply_edits,
    validate_and_apply_splits,
    validate_structural_transition,
)


class PipelineResult:
    def __init__(
        self,
        segments: List[TranscriptSegment],
        outline_state: OutlineState,
        lecture_spans: List[LectureSpan],
        run_manifest: Dict[str, Any],
        request_logs: List[Dict[str, Any]],
    ) -> None:
        self.segments = segments
        self.outline_state = outline_state
        self.lecture_spans = lecture_spans
        self.run_manifest = run_manifest
        self.request_logs = request_logs


class TafrighPipeline:
    """Orchestrates Stages 1-7 for processing Arabic Islamic lecture transcripts."""

    def __init__(
        self,
        pipeline_config: Optional[PipelineConfig] = None,
        matn_config: Optional[MatnConfig] = None,
        adapters: Optional[Dict[str, BaseAdapter]] = None,
    ) -> None:
        self.config = pipeline_config or PipelineConfig()
        self.matn_config = matn_config or MatnConfig()
        self.adapters = adapters or {}
        self._init_default_adapters()

    def _init_default_adapters(self) -> None:
        if "gemini" not in self.adapters:
            self.adapters["gemini"] = GeminiAdapter(typo_strategy=self.config.typo_strategy)
        if "jev" not in self.adapters:
            cfg = JEVRequestConfig(
                jev_layout=self.config.jev_layout,
                execution_order=self.config.jev_execution_order,
            )
            self.adapters["jev"] = JEVAdapter(config=cfg)
        if "laya" not in self.adapters:
            cfg = JEVRequestConfig(
                jev_layout=self.config.jev_layout,
                execution_order=self.config.jev_execution_order,
            )
            self.adapters["laya"] = LayaAdapter(config=cfg)

    def get_active_adapter(self) -> BaseAdapter:
        candidate = self.config.model_candidate
        if candidate == "jev_hybrid":
            return self.adapters["jev"]
        elif candidate == "laya_hybrid":
            return self.adapters["laya"]
        return self.adapters["gemini"]

    def run(
        self,
        raw_text: Optional[str] = None,
        initial_segments: Optional[List[TranscriptSegment]] = None,
        asr_words: Optional[List[Dict[str, Any]]] = None,
        detection_spans: Optional[List[Dict[str, Any]]] = None,
    ) -> PipelineResult:
        started_at = time.time()
        request_logs: List[Dict[str, Any]] = []

        # Stage 1: Segmentation
        if initial_segments is not None:
            segments = initial_segments
        elif raw_text is not None:
            segments = segment_transcript(
                raw_text=raw_text,
                asr_words=asr_words,
                detection_spans=detection_spans,
                use_detection_boundaries=self.config.use_detection_boundaries,
            )
        else:
            raise ValueError("Either raw_text or initial_segments must be provided.")

        # Stage 2: Matn Alignment
        matn_aligner = SequentialMatnAligner(self.matn_config)
        for seg in segments:
            matn_aligner.align_segment(seg)

        # Stage 3, 4, 5: Classification, Splitting, and Typo Correction
        outline_state = OutlineState()

        if self.config.processing_mode == "windowed" and self.config.model_candidate == "gemini_all":
            segments = self._process_windowed(segments, outline_state, request_logs)
        else:
            segments = self._process_per_sentence(segments, outline_state, request_logs)

        # Build lecture spans
        lecture_spans = self._build_lecture_spans(segments)

        run_manifest = {
            "run_id": f"run_{uuid.uuid4().hex[:12]}",
            "processing_mode": self.config.processing_mode,
            "window_size": self.config.window_size,
            "model_candidate": self.config.model_candidate,
            "jev_layout": self.config.jev_layout,
            "jev_execution_order": self.config.jev_execution_order,
            "typo_strategy": self.config.typo_strategy,
            "use_detection_boundaries": self.config.use_detection_boundaries,
            "num_segments": len(segments),
            "wall_clock_seconds": round(time.time() - started_at, 2),
        }

        return PipelineResult(
            segments=segments,
            outline_state=outline_state,
            lecture_spans=lecture_spans,
            run_manifest=run_manifest,
            request_logs=request_logs,
        )

    def _process_per_sentence(
        self,
        segments: List[TranscriptSegment],
        outline_state: OutlineState,
        request_logs: List[Dict[str, Any]],
    ) -> List[TranscriptSegment]:
        adapter = self.get_active_adapter()
        gemini_adapter: GeminiAdapter = self.adapters["gemini"]  # for dedicated splits/edits if hybrid

        i = 0
        while i < len(segments):
            seg = segments[i]
            c_before = segments[max(0, i - self.config.context_before) : i]
            c_after = segments[i + 1 : min(len(segments), i + 1 + self.config.context_after)]

            uow = UnitOfWork(
                uow_id=f"uow_{seg.id}",
                target_segments=[seg],
                context_before=c_before,
                context_after=c_after,
                partial_toc=outline_state.get_partial_toc(),
                current_position_index=i,
                last_confirmed_heading=(
                    outline_state.headings[-1] if outline_state.headings else None
                ),
                allowed_choices=outline_state.get_allowed_structural_choices(
                    include_split_option=(self.config.jev_layout == "split_as_tag_option")
                ),
            )

            t0 = time.perf_counter()
            decisions = adapter.classify_uow(uow)
            latency = (time.perf_counter() - t0) * 1000

            req_log = {
                "request_id": f"req_{uuid.uuid4().hex[:8]}",
                "purpose": "classify",
                "unit_of_work_ids": [seg.id],
                "latency_ms": round(latency, 2),
                "fallback_triggered": False,
            }
            request_logs.append(req_log)

            decision = decisions[0] if decisions else GeminiWindowItemSchema(id=seg.id, tag=StructuralTag.PARAGRAPH)

            # Handle Splitting
            if decision.needsSplitting:
                split_points = decision.splitPoints
                if not split_points:
                    split_points = gemini_adapter.get_split_points(seg, uow)

                val_split = validate_and_apply_splits(seg, split_points)
                if val_split.is_valid and val_split.subsegments:
                    # Replace seg with subsegments and re-process subsegments in place
                    segments[i : i + 1] = val_split.subsegments
                    continue  # Do not advance i; next iteration processes first subsegment
                else:
                    seg.review_flags.append("SPLIT_VALIDATION_FAILED")
                    # Fallback to paragraph if splitting failed
                    decision.tag = StructuralTag.PARAGRAPH
                    decision.needsSplitting = False

            # Validate structural transition
            struct_dec = StructuralDecision(
                tag=decision.tag or StructuralTag.PARAGRAPH,
                level=decision.level,
                parent_id=decision.parent,
                comment_kind=decision.commentKind,
                confidence=decision.confidence,
            )

            val_trans = validate_structural_transition(struct_dec, outline_state)
            if not val_trans.is_valid:
                # Retry fallback to paragraph
                struct_dec = StructuralDecision(tag=StructuralTag.PARAGRAPH)
                seg.review_flags.append("INVALID_TRANSITION_FALLBACK")

            seg.proposed_decision = struct_dec
            seg.final_decision = struct_dec
            outline_state.record_decision(seg.id, seg.original_text, struct_dec)

            # Handle Typo Correction
            if decision.hasTypo or self.config.typo_strategy == "always_correct":
                edits = decision.edits
                if not edits and decision.hasTypo:
                    edits = gemini_adapter.get_typo_edits(seg, uow)
                if edits:
                    validate_and_apply_edits(seg, edits, max_change_ratio=self.config.max_edit_change_ratio)

            i += 1

        return segments

    def _process_windowed(
        self,
        segments: List[TranscriptSegment],
        outline_state: OutlineState,
        request_logs: List[Dict[str, Any]],
    ) -> List[TranscriptSegment]:
        gemini_adapter: GeminiAdapter = self.adapters["gemini"]
        w_size = max(1, self.config.window_size)

        i = 0
        while i < len(segments):
            window_slice = segments[i : min(len(segments), i + w_size)]
            c_before = segments[max(0, i - self.config.context_before) : i]
            c_after = segments[i + len(window_slice) : min(len(segments), i + len(window_slice) + self.config.context_after)]

            uow = UnitOfWork(
                uow_id=f"uow_win_{i:04d}",
                target_segments=window_slice,
                context_before=c_before,
                context_after=c_after,
                partial_toc=outline_state.get_partial_toc(),
                current_position_index=i,
                last_confirmed_heading=(
                    outline_state.headings[-1] if outline_state.headings else None
                ),
                allowed_choices=outline_state.get_allowed_structural_choices(),
            )

            target_ids = [s.id for s in window_slice]
            t0 = time.perf_counter()
            decisions = gemini_adapter.classify_uow(uow)
            latency = (time.perf_counter() - t0) * 1000

            # Window Completeness & Order Check
            returned_ids = [d.id for d in decisions]
            completeness_ok = (returned_ids == target_ids)

            if not completeness_ok:
                # Retry once
                t0_retry = time.perf_counter()
                decisions = gemini_adapter.classify_uow(uow)
                latency += (time.perf_counter() - t0_retry) * 1000
                returned_ids = [d.id for d in decisions]
                completeness_ok = (returned_ids == target_ids)

            if not completeness_ok:
                # Fall back to per_sentence for this window
                req_log = {
                    "request_id": f"req_{uuid.uuid4().hex[:8]}",
                    "purpose": "classify_window_fallback",
                    "unit_of_work_ids": target_ids,
                    "latency_ms": round(latency, 2),
                    "fallback_triggered": True,
                }
                request_logs.append(req_log)

                for s in window_slice:
                    s.review_flags.append("WINDOW_FALLBACK_USED")

                # Process window_slice via per_sentence
                processed_slice = self._process_per_sentence(window_slice, outline_state, request_logs)
                segments[i : i + len(window_slice)] = processed_slice
                i += len(processed_slice)
                continue

            req_log = {
                "request_id": f"req_{uuid.uuid4().hex[:8]}",
                "purpose": "classify_window",
                "unit_of_work_ids": target_ids,
                "latency_ms": round(latency, 2),
                "fallback_triggered": False,
            }
            request_logs.append(req_log)

            # Apply window decisions sequentially, updating OutlineState
            new_window_segments: List[TranscriptSegment] = []
            for cur_seg, d in zip(window_slice, decisions):
                if d.needsSplitting:
                    # Target segment in window requires splitting -> process via per_sentence
                    sub_processed = self._process_per_sentence([cur_seg], outline_state, request_logs)
                    new_window_segments.extend(sub_processed)
                    continue

                struct_dec = StructuralDecision(
                    tag=d.tag or StructuralTag.PARAGRAPH,
                    level=d.level,
                    parent_id=d.parent,
                    comment_kind=d.commentKind,
                    confidence=d.confidence,
                )

                val_trans = validate_structural_transition(struct_dec, outline_state)
                if not val_trans.is_valid:
                    struct_dec = StructuralDecision(tag=StructuralTag.PARAGRAPH)
                    cur_seg.review_flags.append("INVALID_TRANSITION_FALLBACK")

                cur_seg.proposed_decision = struct_dec
                cur_seg.final_decision = struct_dec
                outline_state.record_decision(cur_seg.id, cur_seg.original_text, struct_dec)

                if d.hasTypo or self.config.typo_strategy == "always_correct":
                    edits = d.edits
                    if not edits and d.hasTypo:
                        edits = gemini_adapter.get_typo_edits(cur_seg, uow)
                    if edits:
                        validate_and_apply_edits(cur_seg, edits, max_change_ratio=self.config.max_edit_change_ratio)

                new_window_segments.append(cur_seg)

            segments[i : i + len(window_slice)] = new_window_segments
            i += len(new_window_segments)

        return segments


    def _build_lecture_spans(self, segments: List[TranscriptSegment]) -> List[LectureSpan]:
        """Groups contiguous segments into matn vs sharh lecture spans."""
        spans: List[LectureSpan] = []
        if not segments:
            return spans

        current_type: Optional[str] = None
        current_ids: List[str] = []
        current_texts: List[str] = []
        current_canonical: Optional[str] = None
        has_variant: bool = False

        for seg in segments:
            tag = seg.final_decision.tag if seg.final_decision else StructuralTag.PARAGRAPH
            stype = "matn" if tag == StructuralTag.MATN_SECTION else "sharh"

            if stype != current_type and current_ids:
                spans.append(
                    LectureSpan(
                        span_id=f"span_{len(spans):04d}",
                        span_type=current_type,  # type: ignore
                        segment_ids=current_ids,
                        spoken_text=" ".join(current_texts),
                        canonical_matn_text=current_canonical,
                        has_variant_wording=has_variant,
                    )
                )
                current_ids = []
                current_texts = []
                current_canonical = None
                has_variant = False

            current_type = stype
            current_ids.append(seg.id)
            current_texts.append(seg.active_text)
            if seg.matn_evidence and seg.matn_evidence.canonical_text:
                current_canonical = seg.matn_evidence.canonical_text
                if seg.matn_evidence.has_variant_wording:
                    has_variant = True

        if current_ids and current_type:
            spans.append(
                LectureSpan(
                    span_id=f"span_{len(spans):04d}",
                    span_type=current_type,  # type: ignore
                    segment_ids=current_ids,
                    spoken_text=" ".join(current_texts),
                    canonical_matn_text=current_canonical,
                    has_variant_wording=has_variant,
                )
            )

        return spans
