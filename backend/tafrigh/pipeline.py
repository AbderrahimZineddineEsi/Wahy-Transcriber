"""
Pipeline Orchestrator for Wahy-Transcriber AI Tafrigh Phase.
Executes Stages 1 through 7 in both per_sentence and windowed processing modes.
Ensures zero text mutation, full provenance tracking, and graceful fallback handling.
"""

from __future__ import annotations

import copy
import threading
import time
import uuid
from typing import Any, Callable, Dict, List, Optional, Tuple

from .adapters.base import BaseAdapter
from .adapters.errors import ModelAPIError, redact_secrets
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
from .edit_resolver import resolve_model_edits
from .segmenter import SegmentationConfig, segment_transcript
from .unit_of_work import UnitOfWork, build_units_of_work
from .validators import (
    validate_and_apply_edits,
    validate_and_apply_splits,
    validate_structural_transition,
)


class TafrighModelError(RuntimeError):
    """The model backend is unusable (bad key, unknown model, repeated failures): stop the run with a clear reason."""


MAX_CONSECUTIVE_MODEL_FAILURES = 4


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
        self.segmentation_config: Optional[SegmentationConfig] = None
        self._init_default_adapters()
        # on_progress(done, total, message, details) and control() -> "run" | "pause" | "cancel" are set by the caller
        self.on_progress: Optional[Callable[..., None]] = None
        self.control: Optional[Callable[[], str]] = None
        self._fail_streak = 0
        self._finalized: set = set()
        self._total_initial = 0
        self._stop_id: Optional[str] = None
        self._cancelled = False
        self._paused_sec = 0.0
        self._started = 0.0
        self._stats: Dict[str, Any] = {}
        self._current: Dict[str, Any] = {}
        # The worker holds _lock while it mutates run state and releases it only while waiting on a model
        # request or while paused, so snapshot_result() (another thread) always sees a consistent state.
        self._lock = threading.Lock()
        self._halted = False
        self._live: Optional[Dict[str, Any]] = None

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

    @staticmethod
    def _quote_ranges(seg: TranscriptSegment) -> List[Tuple[int, int]]:
        """Detected quotations inside this sentence, as char ranges relative to it."""
        base, n = seg.source_pos.char_start, len(seg.original_text)
        out = []
        for d in seg.detection_signals:
            a, b = max(0, int(d.get("start", 0)) - base), min(n, int(d.get("end", 0)) - base)
            if a < b:
                out.append((a, b))
        return out

    def _apply_typos(self, seg: TranscriptSegment, raw_edits: List[Any], source: str) -> None:
        """Verify model edits (word-indexed, quoted original, never inside a quotation), then version them."""
        accepted, rejected = resolve_model_edits(seg, raw_edits, protected=self._quote_ranges(seg))
        seg.trace["edits"] = {
            "source": source,
            "proposed": [e if isinstance(e, dict) else getattr(e, "model_dump", lambda: str(e))() for e in raw_edits],
            "accepted": [e.model_dump() | {"original": seg.original_text[e.start:e.end]} for e in accepted],
            "rejected": rejected,
        }
        # a fix inside a detected quotation is not a problem: the quotation is shown from its source anyway
        if any(r.get("why") != "inside_detected_quotation" for r in rejected):
            seg.review_flags.append("EDIT_REJECTED")
        if accepted:
            res = validate_and_apply_edits(seg, accepted, max_change_ratio=self.config.max_edit_change_ratio)
            if getattr(res, "is_valid", False):
                self._stats["edits"] = self._stats.get("edits", 0) + len(accepted)
            else:
                seg.trace["edits"]["validation_error"] = getattr(res, "error", "")

    @staticmethod
    def _model_input(seg: TranscriptSegment, uow: UnitOfWork,
                     before: List[TranscriptSegment], after: List[TranscriptSegment]) -> Dict[str, Any]:
        """What the structural classifier saw for this sentence, kept for Laya fine-tuning exports."""
        state: Dict[str, Any] = {
            "target_text": seg.original_text,
            "context_before": [s.original_text for s in before],
            "context_after": [s.original_text for s in after],
            "partial_toc": uow.partial_toc,
        }
        base, n = seg.source_pos.char_start, len(seg.original_text)
        quotes = [{"type": d.get("type"), "ref": d.get("ref"),
                   "text": seg.original_text[max(0, int(d.get("start", 0)) - base):min(n, max(0, int(d.get("end", 0)) - base))]}
                  for d in seg.detection_signals if d.get("ref")]
        if quotes:
            state["quotations_in_target"] = quotes
        return {"state": state, "allowed_choices": [dict(c) for c in uow.allowed_choices]}

    def _set_current(self, seg: TranscriptSegment, purpose: str) -> None:
        self._current = {"id": seg.id, "text": seg.original_text.strip()[:160], "purpose": purpose}

    def _model_call(self, seg_ids: List[str], purpose: str, fn: Callable[[], Any], request_logs: List[Dict[str, Any]]) -> Any:
        """Run one model call. Config-type failures (bad key / unknown model) abort the run; transient ones
        are logged and returned as None so the caller can flag the segment and carry on."""
        t0 = time.perf_counter()
        self._current["purpose"] = purpose
        try:
            self._lock.release()
            try:
                out = fn()
            finally:
                self._lock.acquire()
            self._fail_streak = 0
            if not purpose.startswith("classify"):  # classify calls are logged by their caller with more detail
                request_logs.append({
                    "request_id": f"req_{uuid.uuid4().hex[:8]}", "purpose": purpose, "unit_of_work_ids": seg_ids,
                    "latency_ms": round((time.perf_counter() - t0) * 1000, 2),
                    "provider": getattr(self.adapters.get("gemini"), "provider_label", "gemini"),
                })
            return out
        except ModelAPIError as exc:
            request_logs.append({
                "request_id": f"req_{uuid.uuid4().hex[:8]}", "purpose": purpose, "unit_of_work_ids": seg_ids,
                "latency_ms": round((time.perf_counter() - t0) * 1000, 2), "error": str(exc), "http_status": exc.status,
            })
            self._stats["errors"] = self._stats.get("errors", 0) + 1
            if exc.status in (400, 401, 402, 403, 404):
                raise TafrighModelError(f"رفض مزود النموذج الطلب (HTTP {exc.status}): {exc}") from exc
            self._fail_streak += 1
        except Exception as exc:  # parse / validation failures from the adapter
            request_logs.append({
                "request_id": f"req_{uuid.uuid4().hex[:8]}", "purpose": purpose, "unit_of_work_ids": seg_ids,
                "latency_ms": round((time.perf_counter() - t0) * 1000, 2), "error": redact_secrets(exc),
            })
            self._stats["errors"] = self._stats.get("errors", 0) + 1
            self._fail_streak += 1
        if self._fail_streak >= MAX_CONSECUTIVE_MODEL_FAILURES:
            raise TafrighModelError(f"فشلت {self._fail_streak} طلبات متتالية إلى النموذج؛ تم إيقاف التفريغ. آخر خطأ مسجل في سجل الطلبات.")
        return None

    def _allowed_choices(self, outline_state: OutlineState, **kw: Any) -> List[Dict[str, Any]]:
        """Structural choices for the model. Without a matn there is nothing to read as «المتن», so that option is withheld."""
        choices = outline_state.get_allowed_structural_choices(**kw)
        has_matn = self.matn_config.mode != "no_matn" and bool(self.matn_config.raw_matn_text or self.matn_config.matn_id)
        if not has_matn:
            choices = [c for c in choices if c.get("tag") != StructuralTag.MATN_SECTION.value]
        return choices

    def _details(self, done: int, total: int) -> Dict[str, Any]:
        calls = sum(int(getattr(a, "request_count", 0) or 0) for a in self.adapters.values())
        cost = sum(float(getattr(a, "total_cost_usd", 0.0) or 0.0) for a in self.adapters.values())
        elapsed = max(0.0, time.time() - self._started - self._paused_sec)
        per = elapsed / done if done else None
        return {
            "done": done, "total": total,
            "elapsed_sec": round(elapsed, 1),
            "sec_per_sentence": round(per, 2) if per else None,
            "eta_sec": round(per * (total - done), 1) if per else None,
            "model_calls": calls, "cost_usd": round(cost, 6),
            "errors": self._stats.get("errors", 0), "splits": self._stats.get("splits", 0),
            "edits": self._stats.get("edits", 0), "tags": dict(self._stats.get("tags", {})),
            "current": dict(self._current), "last_tag": self._stats.get("last_tag"),
        }

    def _report(self, msg: str = "", paused: bool = False) -> None:
        """Progress = segments finalized so far over the target count. Only ever grows, even when sentences
        are split or a window falls back to per-sentence processing (those used to report their own local numbers)."""
        if not self.on_progress:
            return
        done = len(self._finalized)
        total = max(self._total_initial, done + 1)
        info = self._details(done, total)
        info["paused"] = paused
        self.on_progress(done, total, msg.format(done=done, total=total) if msg else "", info)

    def _checkpoint(self) -> bool:
        """Honour pause / stop / cancel between sentences. Returns False when the run must stop."""
        if self._halted:
            return False
        if not self.control:
            return not self._cancelled
        state = self.control()
        if state == "pause":
            t0 = time.time()
            while state == "pause" and not self._halted:
                self._report("متوقف مؤقتاً — {done} من {total}", paused=True)
                self._lock.release()
                try:
                    time.sleep(0.4)
                finally:
                    self._lock.acquire()
                state = self.control()
            self._paused_sec += time.time() - t0
        if state in ("cancel", "stop") or self._halted:
            self._cancelled = True
        return not self._cancelled

    def _record(self, seg: TranscriptSegment, outline_state: OutlineState, dec: StructuralDecision) -> None:
        outline_state.record_decision(seg.id, seg.original_text, dec)
        self._finalized.add(seg.id)
        tag = dec.tag.value if hasattr(dec.tag, "value") else str(dec.tag)
        tags = self._stats.setdefault("tags", {})
        tags[tag] = tags.get(tag, 0) + 1
        self._stats["last_tag"] = tag

    def get_active_adapter(self) -> BaseAdapter:
        candidate = self.config.model_candidate
        if candidate == "jev_hybrid":
            return self.adapters["jev"]
        elif candidate == "laya_hybrid":
            return self.adapters["laya"]
        return self.adapters["gemini"]

    def run(self, *args: Any, **kwargs: Any) -> PipelineResult:
        self._halted = False
        self._live = None
        with self._lock:
            return self._run_locked(*args, **kwargs)

    def snapshot_result(self) -> Optional[PipelineResult]:
        """Called from another thread to stop a run *now*: returns the sentences finalized so far without
        waiting for the in-flight model request, and halts the worker (whatever it finishes later is dropped)."""
        with self._lock:
            self._halted = True
            self._cancelled = True
            if not self._live:
                return None
            live = self._live
            done = [copy.deepcopy(s) for s in list(live["segments"]) if s.id in self._finalized]
            return self._build_result(
                done, copy.deepcopy(live["outline_state"]), list(live["request_logs"]),
                live["start"], live["end"], live["started_at"],
            )

    def _run_locked(
        self,
        raw_text: Optional[str] = None,
        initial_segments: Optional[List[TranscriptSegment]] = None,
        asr_words: Optional[List[Dict[str, Any]]] = None,
        detection_spans: Optional[List[Dict[str, Any]]] = None,
        target_range: Optional[Tuple[int, int]] = None,
    ) -> PipelineResult:
        """target_range = (start, end) sentence indices (end exclusive): only those are classified; their
        neighbours outside the range are still shown to the model as read-only context."""
        started_at = time.time()
        request_logs: List[Dict[str, Any]] = []
        self._fail_streak = 0

        # Stage 1: Segmentation
        if initial_segments is not None:
            segments = initial_segments
        elif raw_text is not None:
            segments = segment_transcript(
                raw_text=raw_text,
                asr_words=asr_words,
                detection_spans=detection_spans,
                use_detection_boundaries=self.config.use_detection_boundaries,
                config=self.segmentation_config,
            )
        else:
            raise ValueError("Either raw_text or initial_segments must be provided.")

        self._finalized = set()
        self._fail_streak = 0
        self._cancelled = False
        self._paused_sec = 0.0
        self._started = started_at
        self._stats = {}
        start, end = 0, len(segments)
        if target_range:
            start = max(0, min(len(segments), int(target_range[0])))
            end = max(start, min(len(segments), int(target_range[1])))
        self._stop_id = segments[end].id if end < len(segments) else None
        self._total_initial = end - start

        # Stage 2: Matn Alignment
        matn_aligner = SequentialMatnAligner(self.matn_config)
        for seg in segments:
            matn_aligner.align_segment(seg)

        # Stage 3, 4, 5: Classification, Splitting, and Typo Correction
        outline_state = OutlineState()
        # segments is mutated in place by both processing modes, so the snapshot can read it live
        self._live = {"segments": segments, "outline_state": outline_state, "request_logs": request_logs,
                      "start": start, "end": end, "started_at": started_at}

        if self.config.processing_mode == "windowed" and self.config.model_candidate == "gemini_all":
            segments = self._process_windowed(segments, outline_state, request_logs, start_index=start)
        else:
            segments = self._process_per_sentence(segments, outline_state, request_logs, start_index=start)
        # only what was actually classified is returned (range runs, cancelled runs)
        segments = [s for s in segments if s.id in self._finalized]
        return self._build_result(segments, outline_state, request_logs, start, end, started_at)

    def _build_result(
        self,
        segments: List[TranscriptSegment],
        outline_state: OutlineState,
        request_logs: List[Dict[str, Any]],
        start: int,
        end: int,
        started_at: float,
    ) -> PipelineResult:
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
            "target_range": [start, end],
            "cancelled": self._cancelled,
            "adapter_mode": "live" if (getattr(self.get_active_adapter(), "is_live", None)
                                       or getattr(self.get_active_adapter(), "api_key", None)) else "offline_heuristic",
            "model_name": getattr(self.adapters.get("gemini"), "model_name", None),
            "gemini_route": getattr(self.adapters.get("gemini"), "provider_label", None),
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
        start_index: int = 0,
    ) -> List[TranscriptSegment]:
        adapter = self.get_active_adapter()
        gemini_adapter: GeminiAdapter = self.adapters["gemini"]  # for dedicated splits/edits if hybrid

        i = start_index
        while i < len(segments) and segments[i].id != self._stop_id:
            if not self._checkpoint():
                break
            seg = segments[i]
            self._set_current(seg, "classify")
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
                allowed_choices=self._allowed_choices(
                    outline_state, include_split_option=(self.config.jev_layout == "split_as_tag_option")
                ),
            )

            self._report("جملة {done} من {total}")
            t0 = time.perf_counter()
            calls0, cost0 = getattr(adapter, "request_count", 0), getattr(adapter, "total_cost_usd", 0.0)
            decisions = self._model_call([seg.id], "classify", lambda: adapter.classify_uow(uow), request_logs)
            latency = (time.perf_counter() - t0) * 1000
            if decisions is None:
                seg.review_flags.append("MODEL_ERROR")
                decisions = []

            req_log = {
                "request_id": f"req_{uuid.uuid4().hex[:8]}",
                "purpose": "classify",
                "unit_of_work_ids": [seg.id],
                "latency_ms": round(latency, 2),
                "fallback_triggered": False,
                "model_calls": getattr(adapter, "request_count", 0) - calls0,
                "cost_estimate_usd": round(getattr(adapter, "total_cost_usd", 0.0) - cost0, 8),
            }
            request_logs.append(req_log)

            decision = decisions[0] if decisions else GeminiWindowItemSchema(id=seg.id, tag=StructuralTag.PARAGRAPH)
            seg.trace["decision"] = dict(decision.trace or {}, latency_ms=round(latency, 1))
            seg.trace["input"] = self._model_input(seg, uow, c_before, c_after)

            # A piece that came out of a split is never split again (this used to recurse until single words),
            # and very short sentences have nothing to split.
            if decision.needsSplitting and ("FROM_SPLIT" in seg.review_flags or len(seg.tokens) < 6):
                seg.trace["split_outcome"] = {"status": "ignored",
                                              "why": "from_split" if "FROM_SPLIT" in seg.review_flags else "too_short"}
                decision.needsSplitting = False
                decision.tag = decision.tag or StructuralTag.PARAGRAPH

            # Handle Splitting
            if decision.needsSplitting:
                split_points = decision.splitPoints
                points_by = "model_decision"
                if not split_points:
                    points_by = getattr(gemini_adapter, "provider_label", "gemini")
                    split_points = self._model_call([seg.id], "split", lambda: gemini_adapter.get_split_points(seg, uow), request_logs) or []

                # never cut inside a detected quotation
                q = self._quote_ranges(seg)
                proposed = list(split_points)
                split_points = [p for p in split_points
                                if 0 < p < len(seg.tokens) and not any(a < seg.tokens[p].char_start < b for a, b in q)]
                seg.trace["split"] = {"proposed": proposed, "used": split_points,
                                      "source": "model_decision" if decision.splitPoints else "gemini_split_request",
                                      "points_by": points_by}
                val_split = validate_and_apply_splits(seg, split_points) if split_points else None
                if val_split is not None and val_split.is_valid and val_split.subsegments:
                    # Replace seg with subsegments and re-process subsegments in place
                    seg.trace["split_outcome"] = {"status": "applied", "pieces": len(val_split.subsegments)}
                    for j, sub in enumerate(val_split.subsegments):
                        sub.review_flags.append("FROM_SPLIT")
                        a, b = sub.source_pos.char_start, sub.source_pos.char_end
                        sub.detection_signals = [d for d in seg.detection_signals if int(d.get("start", 0)) < b and a < int(d.get("end", 0))]
                        sub.trace["split_from"] = {"id": seg.id, "text": seg.original_text.strip(), "split": seg.trace["split"],
                                                   "decision": seg.trace.get("decision"), "input": seg.trace.get("input"),
                                                   "piece": j + 1, "pieces": len(val_split.subsegments)}
                    segments[i : i + 1] = val_split.subsegments
                    self._total_initial += len(val_split.subsegments) - 1
                    self._stats["splits"] = self._stats.get("splits", 0) + 1
                    continue  # Do not advance i; next iteration processes first subsegment
                else:
                    seg.trace["split_outcome"] = {
                        "status": "failed",
                        # no cut points at all / every cut fell inside a detected quotation / cuts rejected by validation
                        "why": "no_points" if not proposed else ("inside_quote" if not split_points else "invalid"),
                        "proposed": proposed,
                    }
                    if val_split is None:
                        seg.review_flags.append("SPLIT_VALIDATION_FAILED")
                    # validate_and_apply_splits already added SPLIT_VALIDATION_FAILED
                    # Splitting failed: keep the classifier's own tag for the whole sentence (paragraph if it gave none)
                    decision.tag = decision.tag or StructuralTag.PARAGRAPH
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
            self._record(seg, outline_state, struct_dec)

            # Handle Typo Correction
            if self.config.typo_strategy != "off" and (decision.hasTypo or self.config.typo_strategy == "always_correct"):
                edits, source = decision.edits, "model_decision"
                if not edits and decision.hasTypo:
                    edits, source = self._model_call([seg.id], "correct", lambda: gemini_adapter.get_typo_edits(seg, uow), request_logs) or [], "gemini_correction_request"
                if edits:
                    self._apply_typos(seg, edits, source)

            i += 1

        return segments

    def _process_windowed(
        self,
        segments: List[TranscriptSegment],
        outline_state: OutlineState,
        request_logs: List[Dict[str, Any]],
        start_index: int = 0,
    ) -> List[TranscriptSegment]:
        gemini_adapter: GeminiAdapter = self.adapters["gemini"]
        w_size = max(1, self.config.window_size)

        def stop_index() -> int:
            ids = [x.id for x in segments]
            return ids.index(self._stop_id) if self._stop_id in ids else len(segments)

        i = start_index
        while i < stop_index():
            if not self._checkpoint():
                break
            window_slice = segments[i : min(stop_index(), i + w_size)]
            self._set_current(window_slice[0], "classify_window")
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
                allowed_choices=self._allowed_choices(outline_state),
            )

            target_ids = [s.id for s in window_slice]
            t0 = time.perf_counter()
            self._report("تمت معالجة {done} من {total} جملة")
            decisions = self._model_call(target_ids, "classify_window", lambda: gemini_adapter.classify_uow(uow), request_logs) or []
            latency = (time.perf_counter() - t0) * 1000

            # Window Completeness & Order Check
            returned_ids = [d.id for d in decisions]
            completeness_ok = (returned_ids == target_ids)

            if not completeness_ok:
                # Retry once
                t0_retry = time.perf_counter()
                decisions = self._model_call(target_ids, "classify_window_retry", lambda: gemini_adapter.classify_uow(uow), request_logs) or []
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
            for k, (cur_seg, d) in enumerate(zip(window_slice, decisions)):
                cur_seg.trace["decision"] = dict(d.trace or {}, window=uow.uow_id)
                # the window's own sentences are context too: the model saw them all at once
                w_before = (list(c_before) + window_slice[:k])[-self.config.context_before:] if self.config.context_before else []
                w_after = (window_slice[k + 1:] + list(c_after))[:self.config.context_after]
                cur_seg.trace["input"] = self._model_input(cur_seg, uow, w_before, w_after)
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
                self._record(cur_seg, outline_state, struct_dec)

                if self.config.typo_strategy != "off" and (d.hasTypo or self.config.typo_strategy == "always_correct"):
                    edits, source = d.edits, "model_decision"
                    if not edits and d.hasTypo:
                        edits, source = self._model_call([cur_seg.id], "correct", lambda: gemini_adapter.get_typo_edits(cur_seg, uow), request_logs) or [], "gemini_correction_request"
                    if edits:
                        self._apply_typos(cur_seg, edits, source)

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
