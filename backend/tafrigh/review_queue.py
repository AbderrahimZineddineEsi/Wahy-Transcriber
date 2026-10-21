"""
Review Queue module for Wahy-Transcriber AI Tafrigh Phase.
Aggregates segments flagged for human inspection and tracks review provenance.
"""

from __future__ import annotations

import uuid
from typing import Any, Callable, Dict, List, Optional

from pydantic import BaseModel, Field

from .models import (
    CommentKind,
    LabelProvenance,
    SegmentVersion,
    StructuralDecision,
    StructuralTag,
    TextEdit,
    TranscriptSegment,
)


class ReviewItem(BaseModel):
    segment_id: str
    original_text: str
    active_text: str
    final_decision: Optional[StructuralDecision] = None
    review_flags: List[str] = Field(default_factory=list)
    confidence: Optional[float] = None
    has_typo_versions: bool = False
    # why this sentence is in the queue: review flags and/or "low_confidence"
    reasons: List[str] = Field(default_factory=list)
    tag_probabilities: Dict[str, float] = Field(default_factory=dict)


# bookkeeping flags: shown in the details view, but not something a reviewer can confirm or fix
INFORMATIONAL_FLAGS = {"FROM_SPLIT", "UNRELIABLE_TIMESTAMP_MAPPING"}


class ReviewQueueManager:
    """Manages flagged transcript segments and coordinates human reviewer actions."""

    def __init__(
        self,
        segments: List[TranscriptSegment],
        confidence_threshold: float = 0.70,
        on_review_action_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> None:
        self.segments = segments
        self.segments_by_id = {s.id: s for s in segments}
        self.confidence_threshold = confidence_threshold
        self.on_review_action_callback = on_review_action_callback

    def get_flagged_segments(self, flag_filter: Optional[str] = None) -> List[TranscriptSegment]:
        """Returns all segments requiring review, filtered optionally by flag."""
        results: List[TranscriptSegment] = []
        for s in self.segments:
            if s.trace.get("review"):          # a human already confirmed or corrected it
                continue
            conf = s.final_decision.confidence if s.final_decision else None
            actionable = [f for f in s.review_flags if f not in INFORMATIONAL_FLAGS]
            needs_review = bool(actionable) or (conf is not None and conf < self.confidence_threshold)

            if needs_review:
                if flag_filter:
                    if flag_filter in s.review_flags:
                        results.append(s)
                else:
                    results.append(s)
        return results

    def get_items(self, flag_filter: Optional[str] = None) -> List[ReviewItem]:
        """Returns review queue items for API/UI rendering."""
        flagged = self.get_flagged_segments(flag_filter)
        items: List[ReviewItem] = []
        for s in flagged:
            conf = s.final_decision.confidence if s.final_decision else None
            reasons = [f for f in s.review_flags if f not in INFORMATIONAL_FLAGS]
            if conf is not None and conf < self.confidence_threshold:
                reasons.append("low_confidence")
            tag_answer = ((s.trace.get("decision") or (s.trace.get("split_from") or {}).get("decision") or {})
                          .get("answers") or {}).get("tag") or {}
            items.append(
                ReviewItem(
                    segment_id=s.id,
                    original_text=s.original_text,
                    active_text=s.active_text,
                    final_decision=s.final_decision,
                    review_flags=s.review_flags,
                    confidence=conf,
                    has_typo_versions=bool(s.active_version_id),
                    reasons=reasons,
                    tag_probabilities=tag_answer.get("probabilities") or {},
                )
            )
        return items

    def confirm_decision(
        self,
        segment_id: str,
        reviewer_id: Optional[str] = None,
        note: Optional[str] = None,
    ) -> TranscriptSegment:
        """Confirms the model decision as correct (HUMAN_CONFIRMED)."""
        seg = self.segments_by_id.get(segment_id)
        if not seg:
            raise KeyError(f"Segment '{segment_id}' not found in review queue.")

        # Update version provenance if active
        if seg.versions:
            active_v = seg.versions[-1]
            if seg.active_version_id:
                for v in seg.versions:
                    if v.version_id == seg.active_version_id:
                        active_v = v
                        break
            active_v.provenance = LabelProvenance.HUMAN_CONFIRMED
            active_v.reviewer_note = note

        seg.review_flags = [f for f in seg.review_flags if f not in ("LOW_CONFIDENCE", "OUTLINE_REPAIR_REVIEW")]

        seg.trace["review"] = {"action": "confirm", "reviewer": reviewer_id, "note": note}

        if self.on_review_action_callback:
            self.on_review_action_callback({
                "action": "confirm",
                "segment_id": segment_id,
                "reviewer_id": reviewer_id,
                "provenance": LabelProvenance.HUMAN_CONFIRMED.value,
                "note": note,
            })

        return seg

    def correct_decision(
        self,
        segment_id: str,
        corrected_tag: Optional[StructuralTag] = None,
        corrected_level: Optional[int] = None,
        corrected_parent: Optional[str] = None,
        corrected_comment_kind: Optional[CommentKind] = None,
        corrected_text: Optional[str] = None,
        reviewer_id: Optional[str] = None,
        note: Optional[str] = None,
    ) -> TranscriptSegment:
        """Applies human correction (HUMAN_CORRECTED) to structure or text."""
        seg = self.segments_by_id.get(segment_id)
        if not seg:
            raise KeyError(f"Segment '{segment_id}' not found in review queue.")

        if corrected_tag:
            seg.final_decision = StructuralDecision(
                tag=corrected_tag,
                level=corrected_level,
                parent_id=corrected_parent,
                comment_kind=corrected_comment_kind,
                confidence=1.0,
            )

        if corrected_text is not None and corrected_text != seg.active_text:
            v_id = f"ver_hc_{uuid.uuid4().hex[:6]}"
            new_v = SegmentVersion(
                version_id=v_id,
                edits=[],
                corrected_text=corrected_text,
                provenance=LabelProvenance.HUMAN_CORRECTED,
                reviewer_note=note,
            )
            seg.versions.append(new_v)
            seg.active_version_id = v_id

        seg.review_flags = [
            f for f in seg.review_flags
            if f not in ("LOW_CONFIDENCE", "INVALID_TRANSITION_FALLBACK", "OUTLINE_REPAIR_REVIEW")
        ]

        seg.trace["review"] = {
            "action": "correct", "reviewer": reviewer_id, "note": note,
            "corrected_tag": corrected_tag.value if corrected_tag else None, "corrected_level": corrected_level,
            "text_changed": corrected_text is not None,
        }

        if self.on_review_action_callback:
            self.on_review_action_callback({
                "action": "correct",
                "segment_id": segment_id,
                "reviewer_id": reviewer_id,
                "provenance": LabelProvenance.HUMAN_CORRECTED.value,
                "corrected_tag": corrected_tag.value if corrected_tag else None,
                "corrected_text": corrected_text,
                "note": note,
            })

        return seg

    def reject_decision(
        self,
        segment_id: str,
        reviewer_id: Optional[str] = None,
        note: Optional[str] = None,
    ) -> TranscriptSegment:
        """Rejects model proposed typo edits, resetting to original ASR text."""
        seg = self.segments_by_id.get(segment_id)
        if not seg:
            raise KeyError(f"Segment '{segment_id}' not found in review queue.")

        seg.active_version_id = None
        seg.review_flags = [f for f in seg.review_flags if f != "EDIT_CAP_EXCEEDED"]

        seg.trace["review"] = {"action": "revert_edits", "reviewer": reviewer_id, "note": note}

        if self.on_review_action_callback:
            self.on_review_action_callback({
                "action": "reject",
                "segment_id": segment_id,
                "reviewer_id": reviewer_id,
                "note": note,
            })

        return seg
