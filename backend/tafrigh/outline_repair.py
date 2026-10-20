"""
Stage 6 Outline Repair Pass module for Wahy-Transcriber.
Detects and repairs global heading hierarchy anomalies, false headings in lists,
and broken matn/sharh span alternation.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field

from .adapters.base import BaseAdapter
from .models import (
    HeadingEntry,
    OutlineState,
    StructuralDecision,
    StructuralTag,
    TranscriptSegment,
)


class AnomalyRecord(BaseModel):
    segment_id: str
    anomaly_type: str
    description: str
    action_taken: str


class OutlineRepairReport(BaseModel):
    anomalies: List[AnomalyRecord] = Field(default_factory=list)
    repaired_count: int = 0
    flagged_for_review_count: int = 0


def partition_lecture_by_anchors(segments: List[TranscriptSegment]) -> List[List[TranscriptSegment]]:
    """
    Partitions a lecture transcript into independent chunks at high-confidence
    standalone matn_section anchors, enabling parallel processing.
    """
    if not segments:
        return []

    chunks: List[List[TranscriptSegment]] = []
    current_chunk: List[TranscriptSegment] = []

    for seg in segments:
        is_anchor = False
        if seg.matn_evidence and seg.matn_evidence.is_candidate_standalone_matn:
            is_anchor = True
        elif seg.final_decision and seg.final_decision.tag == StructuralTag.MATN_SECTION:
            is_anchor = True

        if is_anchor and current_chunk:
            chunks.append(current_chunk)
            current_chunk = [seg]
        else:
            current_chunk.append(seg)

    if current_chunk:
        chunks.append(current_chunk)

    return chunks


def run_outline_repair_pass(
    segments: List[TranscriptSegment],
    outline_state: OutlineState,
    model_adapter: Optional[BaseAdapter] = None,
) -> OutlineRepairReport:
    """
    Stage 6 Post-Pass: Scans finalized segments to detect and repair tree anomalies:
    1. Level Jumps / Orphaned Subheadings.
    2. Single-Child Heading Chains.
    3. False Heading Inside List or short rhetorical questions.
    4. Broken Matn/Sharh Alternation.
    """
    report = OutlineRepairReport()
    id_to_seg = {s.id: s for s in segments}

    # 1. Inspect headings in outline_state
    active_spine: Dict[int, str] = {}  # level -> segment_id
    h1_children: Dict[str, List[str]] = {}  # h1_id -> list of h2_ids

    for h in outline_state.headings:
        seg = id_to_seg.get(h.segment_id)
        if not seg or not seg.final_decision:
            continue

        level = h.level
        parent_id = h.parent_id

        # Anomaly 1: Level Jumps / Orphaned Subheading
        if level > 1:
            expected_parent_level = level - 1
            expected_parent_id = active_spine.get(expected_parent_level)
            if not expected_parent_id or parent_id != expected_parent_id:
                if expected_parent_id:
                    # Repair unambiguous parent pointer
                    h.parent_id = expected_parent_id
                    seg.final_decision.parent_id = expected_parent_id
                    seg.review_flags.append("OUTLINE_REPAIR_APPLIED")
                    report.anomalies.append(
                        AnomalyRecord(
                            segment_id=h.segment_id,
                            anomaly_type="ORPHANED_HEADING_REPAIRED",
                            description=f"Repaired parent pointer of heading '{h.title_text}' to '{expected_parent_id}'",
                            action_taken="auto_repaired",
                        )
                    )
                    report.repaired_count += 1
                else:
                    # Demote to level 1 or flag for review
                    seg.review_flags.append("OUTLINE_REPAIR_REVIEW")
                    report.anomalies.append(
                        AnomalyRecord(
                            segment_id=h.segment_id,
                            anomaly_type="LEVEL_JUMP_FLAGGED",
                            description=f"Heading level {level} has no open parent level {expected_parent_level}",
                            action_taken="flagged_for_review",
                        )
                    )
                    report.flagged_for_review_count += 1

        active_spine[level] = h.segment_id
        # Invalidate deeper levels
        for d in [k for k in active_spine.keys() if k > level]:
            del active_spine[d]

        # Track H1-H2 counts
        if level == 1:
            h1_children[h.segment_id] = []
        elif level == 2 and parent_id:
            if parent_id in h1_children:
                h1_children[parent_id].append(h.segment_id)

    # Anomaly 2: Single-Child Heading Chains
    for h1_id, children in h1_children.items():
        if len(children) == 1:
            child_seg = id_to_seg.get(children[0])
            if child_seg:
                child_seg.review_flags.append("OUTLINE_REPAIR_REVIEW")
                report.anomalies.append(
                    AnomalyRecord(
                        segment_id=children[0],
                        anomaly_type="SINGLE_CHILD_HEADING_CHAIN",
                        description=f"Heading {h1_id} has only one child {children[0]}; suspicious hierarchy inflation",
                        action_taken="flagged_for_review",
                    )
                )
                report.flagged_for_review_count += 1

    # Anomaly 3 & 4: Sequence check across segments
    for idx in range(len(segments)):
        seg = segments[idx]
        tag = seg.final_decision.tag if seg.final_decision else StructuralTag.PARAGRAPH

        # Anomaly 3: Short rhetorical question tagged as heading
        if tag == StructuralTag.HEADING:
            text = seg.original_text.strip()
            if text.endswith("؟") or text.endswith("?"):
                # Rhetorical question inside explanation
                seg.final_decision.tag = StructuralTag.PARAGRAPH
                seg.final_decision.level = None
                seg.final_decision.parent_id = None
                seg.review_flags.append("OUTLINE_REPAIR_APPLIED")
                report.anomalies.append(
                    AnomalyRecord(
                        segment_id=seg.id,
                        anomaly_type="RHETORICAL_QUESTION_HEADING",
                        description=f"Demoted interrogative heading '{text}' to paragraph",
                        action_taken="auto_repaired",
                    )
                )
                report.repaired_count += 1

        # Anomaly 4: Broken matn alternation: consecutive matn_section separated by short continuation
        if idx > 1:
            prev_seg = segments[idx - 1]
            prev_prev_seg = segments[idx - 2]
            t_curr = seg.final_decision.tag if seg.final_decision else None
            t_prev = prev_seg.final_decision.tag if prev_seg.final_decision else None
            t_prev_prev = prev_prev_seg.final_decision.tag if prev_prev_seg.final_decision else None

            if (
                t_curr == StructuralTag.MATN_SECTION
                and t_prev == StructuralTag.CONTINUATION
                and t_prev_prev == StructuralTag.MATN_SECTION
            ):
                # Unify into single matn span by changing continuation to matn_section
                prev_seg.final_decision.tag = StructuralTag.MATN_SECTION
                prev_seg.review_flags.append("OUTLINE_REPAIR_APPLIED")
                report.anomalies.append(
                    AnomalyRecord(
                        segment_id=prev_seg.id,
                        anomaly_type="BROKEN_MATN_CONTINUATION_UNIFIED",
                        description=f"Unified isolated continuation '{prev_seg.id}' into surrounding matn span",
                        action_taken="auto_repaired",
                    )
                )
                report.repaired_count += 1

    return report
